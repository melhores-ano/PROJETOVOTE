-- ============================================================================
-- Prémios Melhores do Ano Portugal — FASE 4F
-- Migração 0010: ajustes administrativos de votos (camada banco/backend)
--
-- OBJECTIVO:
--  - Permitir ao Admin Geral corrigir totais com ajustes manuais (+/-) por
--    participante (campaign × cidade × categoria × negócio), com motivo
--    obrigatório e auditoria completa, SEM tocar em votos individuais.
--  - O apuramento público passa a devolver:
--        total_final = GREATEST(votos_reais + soma_ajustes, 0)
--    (nunca negativo; results_public=false continua fail-closed).
--
-- ÂMBITO (esta etapa = SÓ banco/backend):
--  - NÃO cria interface visual de +/- votos (fica para fase posterior).
--  - NÃO foi executada no Supabase remoto (aplicar manualmente no SQL Editor).
--
-- SEGURANÇA:
--  - RLS activo em public.vote_adjustments.
--  - NENHUMA policy para anon (nem SELECT nem escrita).
--  - Para authenticated: SÓ admins (public.is_admin()) podem INSERT e SELECT.
--    Utilizadores comuns autenticados NÃO lêem nem escrevem (sem policy
--    permissiva, RLS nega por omissão).
--  - UPDATE/DELETE: sem policies + triggers de bloqueio explícito
--    (imutabilidade: correcções via NOVO ajuste compensatório, nunca edição).
--  - service_role NÃO é exposto no frontend (só Edge Functions, se futuras).
--  - Votos individuais em public.votes NÃO são alterados por esta migração.
--  - get_published_results() continua SECURITY DEFINER, só agrega edições
--    com campaigns.results_public=true e NUNCA expõe ip_hash / device_hash /
--    user_agent_hash / vote_attempts / antifraude / votos individuais.
--
-- IDEMPOTENTE e aditiva: segura para re-executar; NÃO altera 0001–0009
-- excepto a redefinição intencional de get_published_results() (4E → 4F)
-- e a extensão retro-compatível de get_admin_tally() / get_admin_vote_overview().
-- ============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- 1. Tabela public.vote_adjustments (auditoria de correcções manuais)
-- --------------------------------------------------------------------------
create table if not exists public.vote_adjustments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  campaign_entry_id uuid not null references public.campaign_entries (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  city_id uuid not null references public.cities (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  adjustment integer not null check (adjustment <> 0),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.vote_adjustments is
  'FASE 4F: ajustes administrativos manuais (+/- votos) por participante. '
  'Cada linha preserva quantidade, motivo obrigatório, admin responsável e data/hora. '
  'IMUTÁVEL: sem UPDATE/DELETE — correcções via novo ajuste compensatório. '
  'Nunca altera public.votes (votos individuais intactos). Leitura/escrita directa só por admins via RLS.';

comment on column public.vote_adjustments.adjustment is
  'Quantidade do ajuste: positiva (acrescenta) ou negativa (remove). Nunca zero (CHECK adjustment <> 0).';
comment on column public.vote_adjustments.reason is
  'Motivo obrigatório da correcção (texto não vazio após trim). Auditoria humana.';
comment on column public.vote_adjustments.created_by is
  'Admin responsável (profiles.id). Preenchido com auth.uid() quando omitido. SET NULL se o perfil for removido.';
comment on column public.vote_adjustments.created_at is
  'Data/hora server-side da criação (default now()).';

-- Índices operacionais (painel futuro + agregação de resultados).
create index if not exists vote_adjustments_scope_idx
  on public.vote_adjustments (campaign_id, city_id, category_id, business_id);
create index if not exists vote_adjustments_entry_idx
  on public.vote_adjustments (campaign_entry_id);
create index if not exists vote_adjustments_campaign_idx
  on public.vote_adjustments (campaign_id);
create index if not exists vote_adjustments_created_idx
  on public.vote_adjustments (created_at desc);
create index if not exists vote_adjustments_created_by_idx
  on public.vote_adjustments (created_by) where created_by is not null;

-- --------------------------------------------------------------------------
-- 2. RLS: só Admin Geral escreve/lê; ninguém mais toca directamente
-- --------------------------------------------------------------------------
alter table public.vote_adjustments enable row level security;

-- Defesa em profundidade: remover qualquer policy permissiva acidental
-- (incluindo restos de execuções manuais) antes de (re)criar as correctas.
drop policy if exists "public read vote_adjustments" on public.vote_adjustments;
drop policy if exists "anon read vote_adjustments" on public.vote_adjustments;
drop policy if exists "public insert vote_adjustments" on public.vote_adjustments;
drop policy if exists "authenticated insert vote_adjustments" on public.vote_adjustments;
drop policy if exists "authenticated read vote_adjustments" on public.vote_adjustments;
drop policy if exists "authenticated update vote_adjustments" on public.vote_adjustments;
drop policy if exists "authenticated delete vote_adjustments" on public.vote_adjustments;
drop policy if exists "admin read vote_adjustments" on public.vote_adjustments;
drop policy if exists "admin insert vote_adjustments" on public.vote_adjustments;

-- Leitura: apenas admins autenticados (visitantes/anon + comuns: sem acesso).
create policy "admin read vote_adjustments" on public.vote_adjustments
  for select to authenticated using (public.is_admin());

-- Escrita: apenas admins autenticados. O motivo/quantidade são validados
-- pelos CHECKs da tabela; a coerência entry↔escopo é validada por trigger.
create policy "admin insert vote_adjustments" on public.vote_adjustments
  for insert to authenticated with check (public.is_admin());

-- NOTA INTENCIONAL: NÃO existe policy de UPDATE nem de DELETE para nenhum
-- role. Com RLS activo e sem policy permissiva, qualquer UPDATE/DELETE
-- directo falha com "new row violates row-level security policy" — mesmo
-- para admins. Os triggers abaixo reforçam com mensagem de negócio clara.

-- --------------------------------------------------------------------------
-- 3. Triggers de auditoria: imutabilidade + coerência + autor + rasto
-- --------------------------------------------------------------------------

-- 3a. Imutabilidade: bloquear UPDATE e DELETE com mensagem accionável.
create or replace function public.vote_adjustments_no_update_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'FASE4F_IMMUTABLE: ajustes administrativos são imutáveis (id=%, operação=%). Crie um NOVO ajuste compensatório em vez de editar/apagar.',
    coalesce(old.id::text, new.id::text), TG_OP
    using errcode = '45000';
  return null;
end;
$$;

drop trigger if exists trg_vote_adjustments_no_update on public.vote_adjustments;
create trigger trg_vote_adjustments_no_update
  before update on public.vote_adjustments
  for each row execute function public.vote_adjustments_no_update_delete();

drop trigger if exists trg_vote_adjustments_no_delete on public.vote_adjustments;
create trigger trg_vote_adjustments_no_delete
  before delete on public.vote_adjustments
  for each row execute function public.vote_adjustments_no_update_delete();

-- 3b. Coerência + autor: o campaign_entry_id tem de pertencer ao mesmo
-- (campaign, city, category, business) do ajuste; created_by omisso herda
-- auth.uid(). Falhas abortam o INSERT com erro de negócio (nada parcial).
create or replace function public.vote_adjustments_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_city_id uuid;
  v_category_id uuid;
  v_business_id uuid;
begin
  select e.campaign_id, e.city_id, e.category_id, e.business_id
    into v_campaign_id, v_city_id, v_category_id, v_business_id
    from public.campaign_entries e
   where e.id = new.campaign_entry_id;

  if not found then
    raise exception 'FASE4F_COHERENCE: campaign_entry_id % não existe.', new.campaign_entry_id
      using errcode = '23503';
  end if;

  if v_campaign_id is distinct from new.campaign_id
     or v_city_id is distinct from new.city_id
     or v_category_id is distinct from new.category_id
     or v_business_id is distinct from new.business_id then
    raise exception 'FASE4F_COHERENCE: o ajuste (campaign=%, city=%, category=%, business=%) não coincide com a participação % (campaign=%, city=%, category=%, business=%).',
      new.campaign_id, new.city_id, new.category_id, new.business_id,
      new.campaign_entry_id, v_campaign_id, v_city_id, v_category_id, v_business_id
      using errcode = '23514';
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vote_adjustments_validate on public.vote_adjustments;
create trigger trg_vote_adjustments_validate
  before insert on public.vote_adjustments
  for each row execute function public.vote_adjustments_validate();

-- 3c. Rasto em audit_logs: cada ajuste gera uma linha de auditoria imutável
-- (actor, acção, entidade, metadados com quantidade + motivo). Best-effort
-- defensivo: se audit_logs estiver indisponível, o ajuste NÃO falha.
create or replace function public.vote_adjustments_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
    values (
      coalesce(new.created_by, auth.uid()),
      'vote_adjustment.created',
      'vote_adjustments',
      new.id::text,
      jsonb_build_object(
        'campaign_id', new.campaign_id,
        'campaign_entry_id', new.campaign_entry_id,
        'business_id', new.business_id,
        'city_id', new.city_id,
        'category_id', new.category_id,
        'adjustment', new.adjustment,
        'reason', new.reason
      )
    );
  exception when others then
    -- Auditoria nunca deve bloquear a escrita principal; o ajuste em si
    -- já preserva quantidade/motivo/autor/data na própria linha.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_vote_adjustments_audit on public.vote_adjustments;
create trigger trg_vote_adjustments_audit
  after insert on public.vote_adjustments
  for each row execute function public.vote_adjustments_audit();

-- --------------------------------------------------------------------------
-- 4. RESULTADOS (4E → 4F): votos reais + ajustes, nunca negativo,
--    results_public continua a ser a autoridade (fail-closed)
-- --------------------------------------------------------------------------
-- CORRECÇÃO 42P13 (executar sobre estado 4E/0003): a Fase 4F altera o
-- RETURNS TABLE de get_published_results(), pelo que CREATE OR REPLACE
-- falha com "cannot change return type of existing function".
-- DROP seguro da assinatura existente ANTES do CREATE; GRANTs + COMMENT
-- são recriados logo abaixo (a função volta a ser SECURITY DEFINER).
drop function if exists public.get_published_results();

create or replace function public.get_published_results()
returns table (
  campaign_id uuid,
  campaign_year integer,
  campaign_name text,
  city_id uuid,
  city_name text,
  city_slug text,
  category_id uuid,
  category_name text,
  category_slug text,
  campaign_entry_id uuid,
  business_id uuid,
  business_name text,
  business_slug text,
  business_verified boolean,
  total_votes bigint,
  "position" integer
)
language sql
security definer
stable
set search_path = public
as $$
  with real_tallies as (
    -- Votos reais por negócio, SÓ de edições publicadas.
    select
      v.campaign_id,
      v.city_id,
      v.category_id,
      v.business_id,
      count(*)::bigint as real_votes
    from public.votes v
    join public.campaigns c on c.id = v.campaign_id
    where c.results_public = true
    group by v.campaign_id, v.city_id, v.category_id, v.business_id
  ),
  adjustment_tallies as (
    -- Soma dos ajustes administrativos por negócio, SÓ de edições publicadas.
    -- (Ajustes de edições não publicadas nunca vazam para o público.)
    select
      a.campaign_id,
      a.city_id,
      a.category_id,
      a.business_id,
      coalesce(sum(a.adjustment), 0)::bigint as adjustments_total
    from public.vote_adjustments a
    join public.campaigns c on c.id = a.campaign_id
    where c.results_public = true
    group by a.campaign_id, a.city_id, a.category_id, a.business_id
  ),
  -- Universo de participantes publicados: quem tem votos reais OU ajustes.
  -- (Inclui quem tem 0 votos reais mas ajuste positivo — ex.: correcção.)
  scope as (
    select campaign_id, city_id, category_id, business_id from real_tallies
    union
    select campaign_id, city_id, category_id, business_id from adjustment_tallies
  ),
  combined as (
    select
      s.campaign_id,
      s.city_id,
      s.category_id,
      s.business_id,
      -- REGRA 4F: total_final = votos reais + ajustes, nunca abaixo de zero.
      greatest(
        coalesce(r.real_votes, 0) + coalesce(a.adjustments_total, 0),
        0
      ) as total_votes
    from scope s
    left join real_tallies r
      on r.campaign_id = s.campaign_id
     and r.city_id = s.city_id
     and r.category_id = s.category_id
     and r.business_id = s.business_id
    left join adjustment_tallies a
      on a.campaign_id = s.campaign_id
     and a.city_id = s.city_id
     and a.category_id = s.category_id
     and a.business_id = s.business_id
  ),
  valid as (
    -- Só participantes válidos: inscrição activa + cidade/categoria/
    -- negócio activos. O join resolve o campaign_entry_id canónico.
    -- Totais zerados após o clamp são excluídos (mesma regra 4E para zeros:
    -- não expor "0 votos"; participantes sem expressão surgem na página da
    -- categoria, não no pódio).
    select
      t.campaign_id,
      t.city_id,
      t.category_id,
      t.business_id,
      e.id as campaign_entry_id,
      t.total_votes
    from combined t
    join public.campaign_entries e
      on e.campaign_id = t.campaign_id
     and e.city_id = t.city_id
     and e.category_id = t.category_id
     and e.business_id = t.business_id
     and e.active = true
    where t.total_votes > 0
  ),
  ranked as (
    -- Empates partilham posição (rank → 1,1,3). Ordenação secundária só
    -- estabilidade visual; nunca declara vencedor exclusivo.
    select
      v.*,
      rank() over (
        partition by v.campaign_id, v.city_id, v.category_id
        order by v.total_votes desc
      )::integer as "position"
    from valid v
  )
  select
    c.id,
    c.year,
    c.name,
    ci.id,
    ci.name,
    ci.slug,
    cat.id,
    cat.name,
    cat.slug,
    r.campaign_entry_id,
    b.id,
    b.name,
    b.slug,
    b.verified,
    r.total_votes,
    r."position"
  from ranked r
  join public.campaigns c on c.id = r.campaign_id
  join public.cities ci on ci.id = r.city_id and ci.active = true
  join public.categories cat on cat.id = r.category_id and cat.active = true
  join public.businesses b on b.id = r.business_id and b.active = true
  order by c.year desc, ci.name asc, cat.name asc,
           r."position" asc, b.name asc, b.slug asc;
$$;

-- Permissões públicas: visitantes + autenticados executam; nada mais muda.
-- (A função é SECURITY DEFINER mas só lê agregados de edições publicadas;
--  nenhum voto individual, hash, antifraude ou vote_attempts é exposto.)
revoke all on function public.get_published_results() from public;
grant execute on function public.get_published_results() to anon, authenticated;

comment on function public.get_published_results() is
  'FASE 4F: agregado público = votos reais (public.votes) + ajustes administrativos '
  '(public.vote_adjustments), por participante. total_final = GREATEST(reais + ajustes, 0) '
  '— nunca negativo. Só edições com results_public=true (fail-closed, zero linhas caso '
  'contrário). Ranking com rank() — empates partilham posição (1,1,3). Só participantes '
  'válidos (campaign_entries active) com total_final > 0. Nunca expõe ip_hash/device_hash/'
  'user_agent_hash/vote_attempts/segredos/votos individuais.';

-- --------------------------------------------------------------------------
-- 5. RPCs ADMIN (extensão retro-compatível: total_final + decomposição)
--    Colunas novas são ADITIVAS — hooks existentes que lêem só
--    (business_id, business_name, business_slug, total_votes, position)
--    continuam a funcionar sem alterações.
-- --------------------------------------------------------------------------

-- 5a. Tally admin por cidade × categoria com decomposição real × ajustes.
-- CORRECÇÃO 42P13: get_admin_tally() 0005 (5 colunas) → 4F (7 colunas:
-- + real_votes, adjustments_total) altera RETURNS TABLE; DROP seguro antes
-- do CREATE. GRANT + COMMENT recriados abaixo.
drop function if exists public.get_admin_tally(uuid, uuid, uuid);

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
  "position" integer,
  real_votes bigint,
  adjustments_total bigint
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
  with real_tallies as (
    select v.business_id, count(*)::bigint as real_votes
    from public.votes v
    where v.campaign_id = p_campaign_id
      and v.city_id = p_city_id
      and v.category_id = p_category_id
    group by v.business_id
  ),
  adjustment_tallies as (
    select a.business_id, coalesce(sum(a.adjustment), 0)::bigint as adjustments_total
    from public.vote_adjustments a
    where a.campaign_id = p_campaign_id
      and a.city_id = p_city_id
      and a.category_id = p_category_id
    group by a.business_id
  ),
  scope as (
    select rt.business_id from real_tallies rt
    union
    select adj.business_id from adjustment_tallies adj
  ),
  combined as (
    select
      s.business_id,
      coalesce(r.real_votes, 0) as real_votes,
      coalesce(a.adjustments_total, 0) as adjustments_total,
      greatest(coalesce(r.real_votes, 0) + coalesce(a.adjustments_total, 0), 0) as total_votes
    from scope s
    left join real_tallies r on r.business_id = s.business_id
    left join adjustment_tallies a on a.business_id = s.business_id
  ),
  ranked as (
    select
      c.business_id, c.real_votes, c.adjustments_total, c.total_votes,
      rank() over (order by c.total_votes desc, c.business_id)::integer as "position"
    from combined c
  )
  select r.business_id, b.name, b.slug, r.total_votes, r."position",
         r.real_votes, r.adjustments_total
  from ranked r
  join public.businesses b on b.id = r.business_id
  order by r."position" asc;
end;
$$;

revoke all on function public.get_admin_tally(uuid, uuid, uuid) from public;
grant execute on function public.get_admin_tally(uuid, uuid, uuid) to authenticated;

comment on function public.get_admin_tally(uuid, uuid, uuid) is
  'FASE 4F: ranking admin por cidade × categoria com total_final = GREATEST(votos reais + '
  'ajustes, 0) + decomposição (real_votes, adjustments_total). Colunas novas aditivas; '
  'total_votes passa a ser o total final (antes: só reais). Exige is_admin() (42501).';

-- 5b. Panorâmica admin: acrescenta ajustes sem quebrar o contrato jsonb.
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
    'total_votes', (
      -- Total final da edição (reais + ajustes, nunca negativo por participante).
      select coalesce(sum(t.total_votes), 0)::bigint from (
        select greatest(
          (select count(*) from public.votes v
            where v.campaign_id = p_campaign_id
              and v.city_id = e.city_id
              and v.category_id = e.category_id
              and v.business_id = e.business_id)
          + coalesce((
            select sum(a.adjustment) from public.vote_adjustments a
            where a.campaign_id = p_campaign_id
              and a.city_id = e.city_id
              and a.category_id = e.category_id
              and a.business_id = e.business_id
          ), 0),
          0
        ) as total_votes
        from (select distinct city_id, category_id, business_id
              from public.campaign_entries
              where campaign_id = p_campaign_id and active = true) e
      ) t
    ),
    'real_votes', (select count(*) from public.votes v where v.campaign_id = p_campaign_id),
    'adjustments_total', (
      select coalesce(sum(a.adjustment), 0)::bigint
      from public.vote_adjustments a where a.campaign_id = p_campaign_id
    ),
    'adjustments_count', (
      select count(*)::bigint
      from public.vote_adjustments a where a.campaign_id = p_campaign_id
    ),
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

comment on function public.get_admin_vote_overview(uuid) is
  'FASE 4F: panorâmica admin (total_final = reais + ajustes por participante, clamp >= 0) + '
  'chaves novas real_votes / adjustments_total / adjustments_count (aditivas). Exige is_admin().';

-- --------------------------------------------------------------------------
-- 6. Guardas: vote_adjustments NUNCA entra no Realtime público
--    (documentado por comentário; aplicação por revisão, como na 0008).
-- --------------------------------------------------------------------------
comment on table public.vote_adjustments is
  'FASE 4F: ajustes administrativos manuais (+/- votos) por participante. '
  'Cada linha preserva quantidade, motivo obrigatório, admin responsável e data/hora. '
  'IMUTÁVEL: sem UPDATE/DELETE — correcções via novo ajuste compensatório. '
  'Nunca altera public.votes. RLS: só admins (SELECT+INSERT). PROIBIDO publicar em '
  'supabase_realtime (como votes/vote_attempts/audit_logs/profiles).';
