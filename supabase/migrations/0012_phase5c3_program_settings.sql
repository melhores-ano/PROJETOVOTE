-- ============================================================================
-- THE BEST EUROPA — FASE 5C.3.2
-- Migração 0012: site_settings multiprograma por award_program (ADITIVA,
-- TRANSCIONAL, IDEMPOTENTE, FAIL-CLOSED, NÃO DESTRUTIVA)
--
-- Estado de partida (validado 0011 aplicada):
--  - public.site_settings: PK = key (text), value jsonb NOT NULL,
--    description text, updated_at timestamptz, is_public bool NOT NULL
--    default false, award_program_id uuid NULLABLE → award_programs(id)
--    ON DELETE CASCADE + índice site_settings_program_idx.
--  - Trigger: site_settings_force_public (0008) — força is_public=true nas
--    12 chaves conhecidas; trigger site_settings_touch (0002) — updated_at.
--  - RLS: "public read public settings" (anon/authenticated, is_public=true)
--    + "admin manage settings" (authenticated, is_admin()). Replica identity
--    FULL + publicação supabase_realtime (0008) — MANTIDAS.
--  - Chaves reais (seed + 0005): site_name, active_campaign_slug,
--    maintenance_mode, results_visible, voting_rules, branding,
--    voting_enabled, turnstile_enabled, turnstile_site_key,
--    vote_rate_window_seconds, vote_rate_max_attempts, vote_rate_max_votes_24h.
--
-- Problema: PK global em `key` impede a mesma chave por programa
-- (ex.: voting_enabled=true em PT e false em FR).
--
-- Solução (sem PK com NULL, sem COALESCE/sentinela):
--  - PK técnica nova: id uuid DEFAULT gen_random_uuid() PRIMARY KEY.
--  - PK antiga em (key) REMOVIDA por descoberta (sem assumir nome).
--  - UNIQUE parcial global:  UNIQUE(key) WHERE award_program_id IS NULL.
--  - UNIQUE parcial programa: UNIQUE(key, award_program_id)
--                              WHERE award_program_id IS NOT NULL.
--
-- Classificação (valores existentes PRESERVADOS, nada inventado):
--  GLOBAL (award_program_id IS NULL — THE BEST EUROPA):
--    maintenance_mode, site_name, branding, turnstile_site_key,
--    vote_rate_window_seconds, vote_rate_max_attempts, vote_rate_max_votes_24h
--  POR AWARD_PROGRAM (→ programa melhores-do-ano-portugal):
--    active_campaign_slug, voting_enabled, results_visible, voting_rules,
--    turnstile_enabled
--  Chaves desconhecidas futuras/extra: permanecem GLOBAIS (NULL) — nunca
--  apagadas, nunca movidas sem classificação explícita.
--
-- Garantias: BEGIN; ... COMMIT; único. Sem COMMIT intermédio. Nenhum DROP
-- destrutivo de dados. Portugal aborta (RAISE EXCEPTION) se o programa não
-- existir. NÃO cria FR/BE. NÃO toca votes/vote_attempts/vote_adjustments/
-- audit_logs/campaign_entries/RPCs. NÃO executa remotamente — ficheiro para
-- aplicação manual posterior.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- 0. Resolver o programa Portugal (FAIL-CLOSED — aborta sem ele).
-- --------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
  from public.award_programs
  where slug = 'melhores-do-ano-portugal' limit 1;

  if v_program_id is null then
    raise exception 'FASE5C32_PROGRAM_NOT_FOUND: programa melhores-do-ano-portugal não encontrado — migration abortada';
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- 1. Garantir coluna award_program_id (herdada da 0011) + FK + índice.
--    Idempotente: se a 0011 já aplicou, nada muda.
-- --------------------------------------------------------------------------
alter table public.site_settings
  add column if not exists award_program_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'site_settings_award_program_id_fkey'
      and conrelid = 'public.site_settings'::regclass
  ) then
    -- Só cria a FK se ainda não existir (nome padrão do Postgres).
    -- Se existir FK com outro nome, preserva-a.
    if not exists (
      select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'site_settings'
        and c.contype = 'f'
        and (select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
             from unnest(c.conkey) with ordinality as u(attnum, ord)
             join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
            ) = array['award_program_id']::text[]
    ) then
      alter table public.site_settings
        add constraint site_settings_award_program_id_fkey
        foreign key (award_program_id)
        references public.award_programs (id) on delete cascade;
    end if;
  end if;
end
$$;

create index if not exists site_settings_program_idx
  on public.site_settings (award_program_id);

-- --------------------------------------------------------------------------
-- 2. PK técnica id uuid (aditiva). Backfill + NOT NULL fail-closed.
-- --------------------------------------------------------------------------
alter table public.site_settings
  add column if not exists id uuid default gen_random_uuid();

-- Linhas pré-existentes: o DEFAULT do ADD COLUMN já preenche, mas garante.
update public.site_settings set id = gen_random_uuid() where id is null;

do $$
declare
  v_nulls bigint;
begin
  select count(*) into v_nulls from public.site_settings where id is null;
  if v_nulls > 0 then
    raise exception 'FASE5C32_BACKFILL_FAILED: site_settings.id contém % registros NULL', v_nulls;
  end if;
  alter table public.site_settings alter column id set not null;
  alter table public.site_settings alter column id set default gen_random_uuid();
end
$$;

-- --------------------------------------------------------------------------
-- 3. Remover a PK global antiga em (key) por DESCOBERTA (sem assumir nome).
--    Preserva UNIQUEs/índices restantes, triggers, RLS, dados.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'site_settings'
      and c.contype = 'p'
      and (
        select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
        from unnest(c.conkey) with ordinality as u(attnum, ord)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
      ) = array['key']::text[]
  loop
    execute format('alter table public.site_settings drop constraint %I', r.conname);
  end loop;
end
$$;

-- --------------------------------------------------------------------------
-- 4. Nova PK técnica em (id), por descoberta (idempotente).
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'site_settings'
      and c.contype = 'p'
  ) then
    alter table public.site_settings add constraint site_settings_pkey primary key (id);
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- 5. UNIQUEs parciais (enforcement multiprograma, sem sentinela).
--    PostgREST/upsert por `key` global DEIXA de ser válido — o frontend
--    passa a SELECT → UPDATE por id / INSERT (ver SettingsAdminPage 5C.3.2).
-- --------------------------------------------------------------------------
create unique index if not exists site_settings_global_key_uidx
  on public.site_settings (key) where award_program_id is null;

create unique index if not exists site_settings_program_key_uidx
  on public.site_settings (key, award_program_id) where award_program_id is not null;

comment on constraint site_settings_pkey on public.site_settings is
  'FASE 5C.3.2: PK técnica (id). A PK global antiga em (key) foi removida para permitir a mesma chave por award_program. Unicidade: site_settings_global_key_uidx (global) + site_settings_program_key_uidx (por programa).';

-- --------------------------------------------------------------------------
-- 6. BACKFILL Portugal: settings POR PROGRAMA → award_program Portugal.
--    Usa EXACTAMENTE os valores existentes (UPDATE, sem INSERT/DELETE).
--    Settings globais permanecem award_program_id IS NULL.
-- --------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
  from public.award_programs
  where slug = 'melhores-do-ano-portugal' limit 1;

  if v_program_id is null then
    raise exception 'FASE5C32_PROGRAM_NOT_FOUND: programa melhores-do-ano-portugal não encontrado — backfill abortado';
  end if;

  update public.site_settings
  set award_program_id = v_program_id
  where key in (
    'active_campaign_slug',
    'voting_enabled',
    'results_visible',
    'voting_rules',
    'turnstile_enabled'
  )
  and award_program_id is null;
end
$$;

-- --------------------------------------------------------------------------
-- 7. RLS — reafirmação idempotente (sem enfraquecer; sem policy pública
--    de INSERT/UPDATE/DELETE). Replica identity FULL mantida (0008).
-- --------------------------------------------------------------------------
alter table public.site_settings enable row level security;

drop policy if exists "public read settings" on public.site_settings;
drop policy if exists "public read public settings" on public.site_settings;
create policy "public read public settings" on public.site_settings
  for select to anon, authenticated using (is_public = true);

drop policy if exists "admin manage settings" on public.site_settings;
create policy "admin manage settings" on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Trigger force_public (0008) mantido SEM alterações funcionais: continua a
-- forçar is_public=true nas 12 chaves conhecidas, agora por linha global OU
-- de programa (NEW.key). Reafirmado idempotente para garantir existência.
create or replace function public.site_settings_force_public()
returns trigger
language plpgsql
as $func$
begin
  if new.key in (
    'site_name',
    'active_campaign_slug',
    'maintenance_mode',
    'results_visible',
    'voting_rules',
    'branding',
    'voting_enabled',
    'turnstile_enabled',
    'turnstile_site_key',
    'vote_rate_window_seconds',
    'vote_rate_max_attempts',
    'vote_rate_max_votes_24h'
  ) then
    new.is_public := true;
  end if;
  return new;
end;
$func$;

drop trigger if exists site_settings_force_public on public.site_settings;
create trigger site_settings_force_public
  before insert or update of key, value, is_public on public.site_settings
  for each row execute function public.site_settings_force_public();

comment on column public.site_settings.award_program_id is
  'FASE 5C.3.2: NULL = configuração global THE BEST EUROPA; preenchido = override do award_program. PK técnica id; unicidade via site_settings_global_key_uidx / site_settings_program_key_uidx. Backfill PT: active_campaign_slug, voting_enabled, results_visible, voting_rules, turnstile_enabled.';

-- --------------------------------------------------------------------------
-- 8. VALIDAÇÕES FAIL-CLOSED antes do COMMIT (qualquer falha aborta tudo).
-- --------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
  v_total bigint;
  v_prog_rows bigint;
  v_prog_nulls bigint;
  v_global_leaked bigint;
  v_dup_global bigint;
  v_dup_program bigint;
  v_lost bigint;
begin
  select id into v_program_id
  from public.award_programs
  where slug = 'melhores-do-ano-portugal' limit 1;
  if v_program_id is null then
    raise exception 'FASE5C32_VALIDATION_FAILED: programa Portugal não existe';
  end if;

  -- 8a. Nenhuma linha perdida: total mínimo = 12 chaves conhecidas.
  select count(*) into v_total from public.site_settings;
  if v_total < 12 then
    raise exception 'FASE5C32_VALIDATION_FAILED: linhas perdidas — total=% (esperado >= 12)', v_total;
  end if;

  -- 8b. Nenhuma setting de programa ficou por associar (NULL indevido).
  select count(*) into v_prog_nulls from public.site_settings
  where key in ('active_campaign_slug','voting_enabled','results_visible','voting_rules','turnstile_enabled')
    and award_program_id is null;
  if v_prog_nulls > 0 then
    raise exception 'FASE5C32_VALIDATION_FAILED: % settings de programa ainda com award_program_id NULL', v_prog_nulls;
  end if;

  -- 8c. Settings de programa associadas ao programa PT (e só a ele, nesta fase).
  select count(*) into v_prog_rows from public.site_settings
  where key in ('active_campaign_slug','voting_enabled','results_visible','voting_rules','turnstile_enabled')
    and award_program_id = v_program_id;
  -- Exige pelo menos as 5 chaves de programa em PT (as 12 chaves existem em prod).
  if v_prog_rows < 5 then
    raise exception 'FASE5C32_VALIDATION_FAILED: settings de programa em PT=% (esperado >= 5)', v_prog_rows;
  end if;

  -- 8d. Settings globais permanecem NULL (nenhuma migrou por engano).
  select count(*) into v_global_leaked from public.site_settings
  where key in ('maintenance_mode','site_name','branding','turnstile_site_key',
                'vote_rate_window_seconds','vote_rate_max_attempts','vote_rate_max_votes_24h')
    and award_program_id is not null;
  if v_global_leaked > 0 then
    raise exception 'FASE5C32_VALIDATION_FAILED: % settings globais com award_program_id preenchido', v_global_leaked;
  end if;

  -- 8e. Sem duplicados globais (mesma key, ambos NULL).
  select count(*) into v_dup_global from (
    select key from public.site_settings
    where award_program_id is null
    group by key having count(*) > 1
  ) d;
  if v_dup_global > 0 then
    raise exception 'FASE5C32_VALIDATION_FAILED: % chaves globais duplicadas', v_dup_global;
  end if;

  -- 8f. Sem duplicados por programa (mesma key + mesmo programa).
  select count(*) into v_dup_program from (
    select key, award_program_id from public.site_settings
    where award_program_id is not null
    group by key, award_program_id having count(*) > 1
  ) d;
  if v_dup_program > 0 then
    raise exception 'FASE5C32_VALIDATION_FAILED: % chaves de programa duplicadas', v_dup_program;
  end if;

  -- 8g. Sanidade de PK técnica.
  select count(*) into v_lost from public.site_settings where id is null;
  if v_lost > 0 then
    raise exception 'FASE5C32_VALIDATION_FAILED: site_settings.id com NULLs';
  end if;
end
$$;

COMMIT;
