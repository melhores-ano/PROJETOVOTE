-- ============================================================================
-- THE BEST EUROPA — FASE 5C.3.9
-- Migração 0015: VOTAÇÃO INDEPENDENTE DAS MODALIDADES
--
-- CONTEXTO:
--  Uma categoria possui 1 VOTAÇÃO PRINCIPAL (sistema eleitoral atual,
--  INTOCÁVEL) + N VOTAÇÕES DE MODALIDADES (ex.: Excelência no Atendimento).
--  Cada modalidade tem votação própria e independente. Uma pessoa pode votar
--  1 vez na principal + 1 vez EM CADA MODALIDADE. A mesma empresa pode vencer
--  várias modalidades legitimamente — NENHUM algoritmo de distribuição.
--
-- REGRA INEGOCIÁVEL (garantida por DESENHO):
--  - NENHUM trigger/função aqui escreve ou lê-agrega em votes,
--    vote_attempts ou vote_adjustments. Nenhuma função existente é redefinida
--    (get_admin_tally, get_admin_vote_overview, get_published_results*).
--  - modality_votes é tabela SEPARADA. Nenhum voto de modalidade aparece como
--    voto principal e vice-versa. vote_adjustments NUNCA usado p/ modalidades.
--  - award_distinctions NÃO é preenchida automaticamente (fase posterior).
--  - cast-vote NÃO é alterada (verificação SHA256 em scripts/verify-*).
--
-- ESCOPO (SÓ fundação de voto por modalidade, SEM seeds):
--  A) modality_votes — voto de modalidade (edição × cidade × categoria ×
--     modalidade × empresa) + hashes antifraude (ip/device/ua). UNIQUE final
--     anti-duplicado: (campaign, city, category, modality, ip_hash).
--  B) modality_vote_attempts — telemetria antifraude SEPARADA (NÃO mistura com
--     vote_attempts para não alterar métricas/bloqueios da votação principal).
--  C) get_admin_modality_tally — RPC admin (SECURITY DEFINER + is_admin)
--     que lê EXCLUSIVAMENTE modality_votes (nunca soma com votes).
--  - NÃO cria países, programas, campanhas, modalidades, votos, 2027.
--  - NÃO executa remotamente — ficheiro local para revisão humana.
--
-- GARANTIAS: transaccional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (IF NOT EXISTS + DROP IF EXISTS antes de CREATE), fail-closed
-- (guards abortam cruzamentos inválidos), RLS admin-read-only via
-- public.is_admin() (sem INSERT/UPDATE/DELETE p/ anon/authenticated — escrita
-- exclusiva via service_role na Edge Function cast-modality-vote), sem
-- hardcode PT/Portugal/2026, multi-programa.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) modality_votes — voto independente por modalidade
-- --------------------------------------------------------------------------
create table if not exists public.modality_votes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  city_id uuid not null references public.cities (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  modality_id uuid not null references public.award_modalities (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  campaign_entry_id uuid references public.campaign_entries (id) on delete set null,
  ip_hash text not null,
  device_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

comment on table public.modality_votes is
  'FASE 5C.3.9: votos independentes por modalidade (edição × cidade × '
  'categoria × modalidade × empresa). Tabela SEPARADA de votes: nenhum voto '
  'de modalidade aparece como voto principal e vice-versa. Escrita exclusiva '
  'via Edge Function cast-modality-vote (service_role). Unicidade final: '
  '(campaign_id, city_id, category_id, modality_id, ip_hash) — 1 voto por '
  'pessoa EM CADA modalidade. Sem IP em claro (só HMAC-SHA256). '
  'vote_adjustments NUNCA usado para modalidades.';

-- Unicidade final anti-duplicado + anti-race (1 pessoa = 1 voto POR MODALIDADE).
-- Outra modalidade da mesma categoria: permitido (modality_id difere).
-- Outra empresa na MESMA modalidade: bloqueado (UNIQUE não inclui business).
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'modality_votes_unique_per_modality_uidx'
  ) then
    create unique index modality_votes_unique_per_modality_uidx
      on public.modality_votes (campaign_id, city_id, category_id, modality_id, ip_hash);
  end if;
end
$$;

create index if not exists modality_votes_tally_idx
  on public.modality_votes (campaign_id, city_id, category_id, modality_id, business_id);
create index if not exists modality_votes_created_idx
  on public.modality_votes (created_at desc);
create index if not exists modality_votes_ip_hash_created_idx
  on public.modality_votes (ip_hash, created_at desc);
create index if not exists modality_votes_device_hash_created_idx
  on public.modality_votes (device_hash, created_at desc)
  where device_hash is not null;
create index if not exists modality_votes_modality_idx
  on public.modality_votes (modality_id);
create index if not exists modality_votes_lookup_idx
  on public.modality_votes (campaign_id, city_id, category_id);

-- Validação cruzada fail-closed (nada parcial), espelhando 0014 + participação:
--  1. modalidade.category_id = voto.category_id (modalidade da categoria);
--  2. campanha / modalidade / categoria no MESMO award_program;
--  3. cidade no país do programa (cities.country_code = programas.country_code);
--  4. empresa estabelecida na cidade (businesses.city_id = voto.city_id);
--  5. participação activa exigida: campaign_entries(active) para
--     (campaign, city, category, business) tem de existir — sem participação,
--     sem voto (mesmo requisito do modelo principal);
--  6. modalidade tem de estar activa (active = true) — voto em modalidade
--     inativa recusado ao nível da BD (defesa em profundidade; a Edge valida
--     antes com mensagem PT amigável).
create or replace function public.modality_votes_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_program uuid;
  v_modality_program uuid;
  v_modality_category uuid;
  v_modality_active boolean;
  v_category_program uuid;
  v_program_country text;
  v_city_country text;
  v_business_city uuid;
  v_entry_id uuid;
begin
  select c.award_program_id into v_campaign_program
  from public.campaigns c where c.id = new.campaign_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: campaign_id % não existe.', new.campaign_id
      using errcode = '23503';
  end if;

  select m.award_program_id, m.category_id, m.active
    into v_modality_program, v_modality_category, v_modality_active
  from public.award_modalities m where m.id = new.modality_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: modality_id % não existe.', new.modality_id
      using errcode = '23503';
  end if;

  select c.award_program_id into v_category_program
  from public.categories c where c.id = new.category_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: category_id % não existe.', new.category_id
      using errcode = '23503';
  end if;

  -- 1. Modalidade pertence a outra categoria → recusa.
  if v_modality_category is distinct from new.category_id then
    raise exception 'FASE5C39_CATEGORY_MISMATCH: modalidade % pertence à categoria %, não a %.',
      new.modality_id, v_modality_category, new.category_id
      using errcode = '23514';
  end if;

  -- 2. Programas cruzados → recusa.
  if v_campaign_program is distinct from v_modality_program
     or v_campaign_program is distinct from v_category_program then
    raise exception 'FASE5C39_PROGRAM_MISMATCH: campanha (programa=%) × modalidade (programa=%) × categoria (programa=%) incompatíveis. Cruzamento entre programas recusado.',
      v_campaign_program, v_modality_program, v_category_program
      using errcode = '23514';
  end if;

  -- 3. Cidade de outro país/programa → recusa.
  select p.country_code into v_program_country
  from public.award_programs p where p.id = v_campaign_program;
  select ci.country_code into v_city_country
  from public.cities ci where ci.id = new.city_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: city_id % não existe.', new.city_id
      using errcode = '23503';
  end if;
  if v_city_country is distinct from v_program_country then
    raise exception 'FASE5C39_COUNTRY_MISMATCH: cidade % (país=%) fora do país do programa (%).',
      new.city_id, v_city_country, v_program_country
      using errcode = '23514';
  end if;

  -- 4. Empresa fora da cidade → recusa.
  select b.city_id into v_business_city
  from public.businesses b where b.id = new.business_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: business_id % não existe.', new.business_id
      using errcode = '23503';
  end if;
  if v_business_city is distinct from new.city_id then
    raise exception 'FASE5C39_CITY_MISMATCH: empresa % estabelecida na cidade %, não em %.',
      new.business_id, v_business_city, new.city_id
      using errcode = '23514';
  end if;

  -- 5. Sem participação activa → recusa (requisito do modelo principal).
  select ce.id into v_entry_id
  from public.campaign_entries ce
  where ce.campaign_id = new.campaign_id
    and ce.city_id = new.city_id
    and ce.category_id = new.category_id
    and ce.business_id = new.business_id
    and ce.active = true
  limit 1;
  if not found then
    raise exception 'FASE5C39_NO_PARTICIPATION: empresa % sem participação activa em campanha % × cidade % × categoria %.',
      new.business_id, new.campaign_id, new.city_id, new.category_id
      using errcode = '23514';
  end if;

  -- Preenche campaign_entry_id quando omitido (a Edge envia sempre; este
  -- fallback mantém integridade para escrita via service_role).
  if new.campaign_entry_id is null then
    new.campaign_entry_id := v_entry_id;
  end if;

  -- 6. Modalidade inativa → recusa.
  if v_modality_active is not true then
    raise exception 'FASE5C39_MODALITY_INACTIVE: modalidade % inativa — voto recusado.',
      new.modality_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_modality_votes_validate on public.modality_votes;
create trigger trg_modality_votes_validate
  before insert or update of campaign_id, city_id, category_id, modality_id, business_id
  on public.modality_votes
  for each row execute function public.modality_votes_validate();

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
create or replace function public.modality_votes_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
    values (
      auth.uid(),
      case when TG_OP = 'INSERT' then 'modality_vote.created' else 'modality_vote.updated' end,
      'modality_votes',
      new.id::text,
      jsonb_build_object(
        'campaign_id', new.campaign_id,
        'city_id', new.city_id,
        'category_id', new.category_id,
        'modality_id', new.modality_id,
        'business_id', new.business_id
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_modality_votes_audit on public.modality_votes;
create trigger trg_modality_votes_audit
  after insert or update on public.modality_votes
  for each row execute function public.modality_votes_audit();

alter table public.modality_votes enable row level security;

drop policy if exists "public read modality_votes" on public.modality_votes;
drop policy if exists "anon read modality_votes" on public.modality_votes;
drop policy if exists "authenticated read modality_votes" on public.modality_votes;
drop policy if exists "admin manage modality_votes" on public.modality_votes;
drop policy if exists "admin read modality_votes" on public.modality_votes;

-- Fundação 5C.3.9: leitura SOMENTE por admins; SEM policy de INSERT/UPDATE/
-- DELETE para anon/authenticated — com RLS activo e sem policy permissiva,
-- qualquer INSERT directo do browser falha. Escrita exclusiva via service_role
-- na Edge Function cast-modality-vote (bypass RLS). Publicação pública de
-- resultados de modalidades: fase posterior (nada público aqui).
create policy "admin read modality_votes" on public.modality_votes
  for select to authenticated using (public.is_admin());

-- --------------------------------------------------------------------------
-- B) modality_vote_attempts — telemetria antifraude SEPARADA
-- --------------------------------------------------------------------------
-- NUNCA misturada com vote_attempts: métricas, bloqueios e resultados da
-- votação principal permanecem intactos. Mesmo padrão (hashes, sem IP puro).
create table if not exists public.modality_vote_attempts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete set null,
  city_id uuid references public.cities (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  modality_id uuid references public.award_modalities (id) on delete set null,
  business_id uuid references public.businesses (id) on delete set null,
  outcome text not null default 'invalido'
    check (outcome in ('aceite','duplicado','bloqueado','invalido','rate_limit')),
  reason text,
  ip_hash text,
  device_hash text,
  created_at timestamptz not null default now()
);

comment on table public.modality_vote_attempts is
  'FASE 5C.3.9: telemetria antifraude DOS VOTOS DE MODALIDADE, separada de '
  'vote_attempts (a votação principal nunca é afectada). Hashes apenas '
  '(ip_hash, device_hash) — sem IP em claro. Escrita via Edge Function '
  'cast-modality-vote; leitura apenas por admins.';

create index if not exists modality_vote_attempts_created_idx
  on public.modality_vote_attempts (created_at desc);
create index if not exists modality_vote_attempts_outcome_idx
  on public.modality_vote_attempts (outcome);
create index if not exists modality_vote_attempts_ip_created_idx
  on public.modality_vote_attempts (ip_hash, created_at desc)
  where ip_hash is not null;
create index if not exists modality_vote_attempts_device_created_idx
  on public.modality_vote_attempts (device_hash, created_at desc)
  where device_hash is not null;
create index if not exists modality_vote_attempts_modality_idx
  on public.modality_vote_attempts (campaign_id, city_id, category_id, modality_id);

alter table public.modality_vote_attempts enable row level security;

drop policy if exists "public read modality_vote_attempts" on public.modality_vote_attempts;
drop policy if exists "anon read modality_vote_attempts" on public.modality_vote_attempts;
drop policy if exists "admin read modality_vote_attempts" on public.modality_vote_attempts;

create policy "admin read modality_vote_attempts" on public.modality_vote_attempts
  for select to authenticated using (public.is_admin());

-- NOTA: propositadamente NENHUMA policy de INSERT/UPDATE/DELETE em
-- modality_votes / modality_vote_attempts para anon/authenticated.

-- --------------------------------------------------------------------------
-- C) RPC ADMIN — tally por modalidade (lê EXCLUSIVAMENTE modality_votes)
-- --------------------------------------------------------------------------
-- Nunca soma com votes. SECURITY DEFINER + guarda is_admin() (42501).
create or replace function public.get_admin_modality_tally(
  p_campaign_id uuid,
  p_city_id uuid,
  p_category_id uuid,
  p_modality_id uuid
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
    from public.modality_votes v
    where v.campaign_id = p_campaign_id
      and v.city_id = p_city_id
      and v.category_id = p_category_id
      and v.modality_id = p_modality_id
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

revoke all on function public.get_admin_modality_tally(uuid, uuid, uuid, uuid) from public;
grant execute on function public.get_admin_modality_tally(uuid, uuid, uuid, uuid) to authenticated;

comment on function public.get_admin_modality_tally(uuid, uuid, uuid, uuid) is
  'FASE 5C.3.9: apuramento admin POR MODALIDADE — lê exclusivamente '
  'modality_votes (nunca soma com votes, nunca usa vote_adjustments). '
  'Exige is_admin() server-side. Publicação pública: fase posterior.';

-- --------------------------------------------------------------------------
-- D) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_bad_program bigint;
  v_bad_country bigint;
  v_bad_city bigint;
  v_bad_category bigint;
  v_bad_participation bigint;
  v_bad_inactive_modality bigint;
begin
  -- D1. Nenhum voto com (campanha × modalidade × categoria) cruzados.
  select count(*) into v_bad_program
  from public.modality_votes v
  join public.campaigns cam on cam.id = v.campaign_id
  join public.award_modalities m on m.id = v.modality_id
  join public.categories cat on cat.id = v.category_id
  where cam.award_program_id is distinct from m.award_program_id
     or cam.award_program_id is distinct from cat.award_program_id
     or m.category_id is distinct from v.category_id;
  if v_bad_program > 0 then
    raise exception 'FASE5C39_VALIDATION_FAILED: % modality_votes com programa/categoria cruzados', v_bad_program;
  end if;

  -- D2. Nenhum voto com cidade fora do país do programa.
  select count(*) into v_bad_country
  from public.modality_votes v
  join public.campaigns cam on cam.id = v.campaign_id
  join public.award_programs p on p.id = cam.award_program_id
  join public.cities ci on ci.id = v.city_id
  where ci.country_code is distinct from p.country_code;
  if v_bad_country > 0 then
    raise exception 'FASE5C39_VALIDATION_FAILED: % modality_votes com cidade fora do país do programa', v_bad_country;
  end if;

  -- D3. Nenhum voto com empresa fora da cidade.
  select count(*) into v_bad_city
  from public.modality_votes v
  join public.businesses b on b.id = v.business_id
  where b.city_id is distinct from v.city_id;
  if v_bad_city > 0 then
    raise exception 'FASE5C39_VALIDATION_FAILED: % modality_votes com empresa fora da cidade', v_bad_city;
  end if;

  -- D4. Nenhum voto sem participação activa.
  select count(*) into v_bad_participation
  from public.modality_votes v
  left join public.campaign_entries ce
    on ce.campaign_id = v.campaign_id
   and ce.city_id = v.city_id
   and ce.category_id = v.category_id
   and ce.business_id = v.business_id
   and ce.active = true
  where ce.id is null;
  if v_bad_participation > 0 then
    raise exception 'FASE5C39_VALIDATION_FAILED: % modality_votes sem participação activa', v_bad_participation;
  end if;

  -- D5. Nenhum voto em modalidade inativa (defesa; a Edge bloqueia antes).
  select count(*) into v_bad_inactive_modality
  from public.modality_votes v
  join public.award_modalities m on m.id = v.modality_id
  where m.active is not true;
  if v_bad_inactive_modality > 0 then
    raise exception 'FASE5C39_VALIDATION_FAILED: % modality_votes em modalidade inativa', v_bad_inactive_modality;
  end if;

  -- D6. Listas de valores íntegras em modality_vote_attempts.
  select count(*) into v_bad_category
  from public.modality_vote_attempts a
  where a.outcome not in ('aceite','duplicado','bloqueado','invalido','rate_limit');
  if v_bad_category > 0 then
    raise exception 'FASE5C39_VALIDATION_FAILED: % modality_vote_attempts com outcome inválido', v_bad_category;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments nem redefinir RPCs de
-- apuramento principal. Verificação textual fail-closed sobre o próprio
-- esquema (a prova executável vive em scripts/verify-phase5c39.mjs).
-- (Implementada como comentário estrutural auditável.)

COMMIT;
