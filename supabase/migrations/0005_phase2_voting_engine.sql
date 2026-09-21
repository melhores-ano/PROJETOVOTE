-- ============================================================================
-- Prémios Melhores do Ano Portugal — PHASE 2
-- Migração 0005: motor de votação seguro em produção
--
-- Princípios:
--  1. O frontend NUNCA insere directamente em `votes` (sem policy de INSERT/
--     UPDATE/DELETE para anon/authenticated — apenas service_role via Edge).
--  2. Unicidade (campaign, city, category, ip_hash) imposta ao nível da BD
--     como protecção final contra race conditions (SELECT-before-INSERT
--     isolado NÃO chega — dois pedidos simultâneos seriam ambos aceites).
--  3. Nenhum IP em claro é persistido: a Edge Function deriva a identidade
--     de rede server-side e guarda apenas HMAC-SHA256 com VOTE_HASH_SECRET.
--  4. Totais de votos NUNCA são expostos publicamente enquanto
--     results_public=false (só via RPC publicada ou funções admin).
--  5. Não-destrutiva e idempotente: segura para re-executar.
-- ============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- 1. Garantir constraint UNIQUE final anti-duplicado
--    (campaign_id, city_id, category_id, ip_hash)
--    Já existia na 0001; aqui garantimos via índice único dedicado com nome
--    estável para que a Edge Function possa apanhar o erro 23505 de forma
--    determinística mesmo se a constraint original tiver outro nome.
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'votes_unique_ip_per_category_uidx'
  ) then
    create unique index votes_unique_ip_per_category_uidx
      on public.votes (campaign_id, city_id, category_id, ip_hash);
  end if;
end
$$;

-- Índice secundário para rate-limit / auditoria por identidade de rede.
create index if not exists votes_ip_hash_created_idx
  on public.votes (ip_hash, created_at desc);
create index if not exists votes_device_hash_created_idx
  on public.votes (device_hash, created_at desc)
  where device_hash is not null;

-- Índices para o rate-limit baseado em vote_attempts (janela deslizante).
create index if not exists vote_attempts_ip_created_idx
  on public.vote_attempts (ip_hash, created_at desc)
  where ip_hash is not null;
create index if not exists vote_attempts_device_created_idx
  on public.vote_attempts (device_hash, created_at desc)
  where device_hash is not null;

-- --------------------------------------------------------------------------
-- 2. Configurações seguras da votação (site_settings)
--    `turnstile_*` público: apenas flags/site-key (SEM segredos).
--    Segredos reais (VOTE_HASH_SECRET, TURNSTILE_SECRET_KEY, service_role)
--    vivem APENAS como Edge Secrets — nunca em site_settings nem no frontend.
-- --------------------------------------------------------------------------
insert into public.site_settings (key, value, description) values
  ('voting_enabled', 'true', 'Interruptor global da votação pública (Edge Function cast-vote).'),
  ('turnstile_enabled', 'false', 'Quando true, a Edge Function exige token Cloudflare Turnstile válido.'),
  ('turnstile_site_key', '""', 'Site key pública do Cloudflare Turnstile (segura para expor no frontend).'),
  ('vote_rate_window_seconds', '600', 'Janela deslizante do rate-limit (segundos).'),
  ('vote_rate_max_attempts', '20', 'Máximo de tentativas por ip_hash dentro da janela.'),
  ('vote_rate_max_votes_24h', '30', 'Máximo de votos aceites por ip_hash em 24h (limite anti-fazenda de votos).')
on conflict (key) do nothing;

-- --------------------------------------------------------------------------
-- 3. REVISÃO TOTAL DAS POLICIES RLS (endurecimento Fase 2)
--    Objectivo: votes/vote_attempts rejeitam INSERT/UPDATE/DELETE anónimo
--    E autenticado; apenas service_role (Edge) escreve e admins lêem.
-- --------------------------------------------------------------------------

-- 3a. Remover QUALQUER policy permissiva acidental em votes/vote_attempts
--     para anon (se alguma migração futura/externa a tiver criado).
drop policy if exists "public insert votes" on public.votes;
drop policy if exists "public update votes" on public.votes;
drop policy if exists "public delete votes" on public.votes;
drop policy if exists "public read votes" on public.votes;
drop policy if exists "anon read votes" on public.votes;
drop policy if exists "authenticated insert votes" on public.votes;
drop policy if exists "authenticated update votes" on public.votes;
drop policy if exists "authenticated delete votes" on public.votes;
drop policy if exists "public insert vote_attempts" on public.vote_attempts;
drop policy if exists "public read vote_attempts" on public.vote_attempts;
drop policy if exists "anon read vote_attempts" on public.vote_attempts;

-- 3b. Reafirmar leitura admin (idempotente — já existia na 0001).
drop policy if exists "admin read votes" on public.votes;
create policy "admin read votes" on public.votes
  for select to authenticated using (public.is_admin());

drop policy if exists "admin read vote_attempts" on public.vote_attempts;
create policy "admin read vote_attempts" on public.vote_attempts
  for select to authenticated using (public.is_admin());

-- NOTA: propositadamente NÃO existe nenhuma policy de INSERT/UPDATE/DELETE
-- em votes/vote_attempts para anon/authenticated. Com RLS activo e sem
-- policy permissiva, qualquer INSERT directo do browser falha com
-- `new row violates row-level security policy`. A escrita faz-se apenas com
-- service_role dentro da Edge Function cast-vote (bypass RLS).

-- 3c. Garantir que is_admin/is_super_admin mantêm search_path fixo.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  );
$$;

-- --------------------------------------------------------------------------
-- 4. Helper: campanha aberta para voto? (server-side, tempo do servidor)
--    Considera-se "activa" para voto: status IN ('activa','votacao')
--    + start_at <= now() + end_at >= now() (limites nulos = sem limite).
-- --------------------------------------------------------------------------
create or replace function public.is_campaign_open(p_campaign_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = p_campaign_id
      and c.status in ('activa', 'votacao')
      and (c.start_at is null or c.start_at <= now())
      and (c.end_at is null or c.end_at >= now())
  );
$$;

revoke all on function public.is_campaign_open(uuid) from public;
grant execute on function public.is_campaign_open(uuid) to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 5. AGREGADOS SEGUROS PARA ADMINS (SECURITY DEFINER + verificação is_admin)
--    O frontend público NUNCA chama estas funções. O painel admin usa-as
--    em vez de varrer `votes` quando possível (menos dados transferidos,
--    nenhuma linha individual exposta a mais).
-- --------------------------------------------------------------------------

-- 5a. Panorâmica: total, hoje, por cidade, por categoria.
create or replace function public.get_admin_vote_overview(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado: só administradores.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'campaign_id', p_campaign_id,
    'total_votes', (select count(*) from public.votes v where v.campaign_id = p_campaign_id),
    'votes_today', (
      select count(*) from public.votes v
      where v.campaign_id = p_campaign_id
        and v.created_at >= date_trunc('day', now())
    ),
    'votes_last_7d', (
      select count(*) from public.votes v
      where v.campaign_id = p_campaign_id
        and v.created_at >= now() - interval '7 days'
    ),
    'by_city', coalesce((
      select jsonb_agg(row_to_json(t) order by t.total_votes desc)
      from (
        select ci.id as city_id, ci.name as city_name, ci.slug as city_slug,
               count(v.id)::bigint as total_votes
        from public.votes v
        join public.cities ci on ci.id = v.city_id
        where v.campaign_id = p_campaign_id
        group by ci.id, ci.name, ci.slug
      ) t
    ), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(row_to_json(t) order by t.total_votes desc)
      from (
        select cat.id as category_id, cat.name as category_name, cat.slug as category_slug,
               count(v.id)::bigint as total_votes
        from public.votes v
        join public.categories cat on cat.id = v.category_id
        where v.campaign_id = p_campaign_id
        group by cat.id, cat.name, cat.slug
      ) t
    ), '[]'::jsonb),
    'attempts_by_outcome', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select a.outcome, count(a.id)::bigint as total
        from public.vote_attempts a
        where a.campaign_id = p_campaign_id
          and a.created_at >= now() - interval '30 days'
        group by a.outcome
      ) t
    ), '[]'::jsonb),
    'generated_at', now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_admin_vote_overview(uuid) from public;
grant execute on function public.get_admin_vote_overview(uuid) to authenticated;

-- 5b. Tally por participante (ranking) para cidade × categoria.
create or replace function public.get_admin_tally(
  p_campaign_id uuid,
  p_city_id uuid,
  p_category_id uuid
)
returns table (
  business_id uuid,
  business_name text,
  business_slug text,
  total_votes bigint,
  "position" integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado: só administradores.' using errcode = '42501';
  end if;

  return query
  with tallies as (
    select v.business_id, count(*)::bigint as total_votes
    from public.votes v
    where v.campaign_id = p_campaign_id
      and v.city_id = p_city_id
      and v.category_id = p_category_id
    group by v.business_id
  ),
  ranked as (
    select t.business_id, t.total_votes,
           row_number() over (order by t.total_votes desc, t.business_id)::integer as "position"
    from tallies t
  )
  select r.business_id, b.name, b.slug, r.total_votes, r."position"
  from ranked r
  join public.businesses b on b.id = r.business_id
  order by r."position" asc;
end;
$$;

revoke all on function public.get_admin_tally(uuid, uuid, uuid) from public;
grant execute on function public.get_admin_tally(uuid, uuid, uuid) to authenticated;

-- 5c. Linha temporal de votos (baldes diários) para gráficos admin.
create or replace function public.get_admin_vote_timeline(
  p_campaign_id uuid,
  p_days integer default 30
)
returns table (day date, total_votes bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado: só administradores.' using errcode = '42501';
  end if;

  if p_days is null or p_days < 1 then p_days := 30; end if;
  if p_days > 365 then p_days := 365; end if;

  return query
  with series as (
    select generate_series(
      date_trunc('day', now()) - ((p_days - 1) || ' days')::interval,
      date_trunc('day', now()),
      interval '1 day'
    ) as bucket
  )
  select s.bucket::date as day,
         count(v.id)::bigint as total_votes
  from series s
  left join public.votes v
    on v.campaign_id = p_campaign_id
   and date_trunc('day', v.created_at) = s.bucket
  group by s.bucket
  order by s.bucket asc;
end;
$$;

revoke all on function public.get_admin_vote_timeline(uuid, integer) from public;
grant execute on function public.get_admin_vote_timeline(uuid, integer) to authenticated;

-- --------------------------------------------------------------------------
-- 6. Documentação viva: comentários nas tabelas críticas
-- --------------------------------------------------------------------------
comment on table public.votes is
  'Fase 2: escrita EXCLUSIVA via Edge Function cast-vote (service_role). '
  'Sem policies de INSERT/UPDATE/DELETE para anon/authenticated — RLS nega por omissão. '
  'Unicidade final: (campaign_id, city_id, category_id, ip_hash). Sem IP em claro.';
comment on table public.vote_attempts is
  'Fase 2: telemetria antifraude com hashes (ip_hash, device_hash). '
  'Escrita via Edge Function; leitura apenas por admins. Não expor publicamente.';
