-- ============================================================================
-- THE BEST EUROPA — FASE 5C.3.8
-- Migração 0014: arquitetura de MODALIDADES / DISTINÇÕES
--
-- CONTEXTO:
--  Categoria → Modalidades / Distinções (ex.: Restaurantes →
--  "Excelência no Atendimento"). O resultado eleitoral (votes /
--  vote_adjustments / RPCs de apuramento) NÃO é tocado por esta migração.
--
-- REGRA INEGOCIÁVEL (garantida por DESENHO):
--  - NENHUM trigger/função aqui escreve em votes, vote_attempts ou
--    vote_adjustments. Nenhuma função existente é redefinida.
--  - A recusa comercial (commercial_status = declined) NUNCA transfere o
--    1.º lugar, NUNCA altera votos/ranking histórico.
--  - Mérito (award_status) e relação comercial (commercial_status) vivem em
--    colunas SEPARADAS em award_distinctions.
--
-- ESCOPO (SÓ fundação, SEM seeds, SEM monetização):
--  A) award_modalities — DEFINIÇÃO da modalidade (por programa + categoria).
--     SEM seed: nenhum INSERT de modalidades aqui (cadastro futuro no Admin).
--  B) award_distinctions — DISTINÇÃO atribuída numa edição (campanha ×
--     cidade × categoria × modalidade × empresa), com source auditável e
--     estados separados award_status / commercial_status.
--  - NÃO cria países, programas, campanhas, preços, pagamentos, Stripe.
--  - NÃO altera votes / vote_attempts / vote_adjustments / RPCs
--    (get_admin_tally, get_admin_vote_overview, get_published_results*).
--  - NÃO executa remotamente — ficheiro local para revisão antes de aplicar
--    ao Supabase remoto (db push PROIBIDO nesta fase).
--
-- GARANTIAS: transaccional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (IF NOT EXISTS + DROP IF EXISTS antes de CREATE), fail-closed
-- (guards abortam em cruzamentos inválidos), RLS admin-only via
-- public.is_admin(), sem policy para anon. Sem service role no frontend.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) award_modalities — definição da modalidade de distinção
-- --------------------------------------------------------------------------
create table if not exists public.award_modalities (
  id uuid primary key default gen_random_uuid(),
  award_program_id uuid not null references public.award_programs (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null check (length(trim(slug)) > 0),
  description text,
  icon text,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.award_modalities is
  'FASE 5C.3.8: modalidades de distinção dentro de uma categoria '
  '(ex.: Restaurantes → Excelência no Atendimento). DEFINIÇÃO — não é '
  'resultado eleitoral. Pertence obrigatoriamente ao mesmo award_program da '
  'categoria (validado por trigger). SEM seeds: cadastro futuro no Admin. '
  'Nunca altera votes / vote_adjustments.';

comment on column public.award_modalities.award_program_id is
  'FASE 5C.3.8: programa dono da modalidade (FK → award_programs). '
  'ON DELETE RESTRICT: programa com modalidades não pode ser eliminado. '
  'Tem de coincidir com categories.award_program_id (trigger).';

comment on column public.award_modalities.category_id is
  'FASE 5C.3.8: categoria dona da modalidade (FK → categories). '
  'ON DELETE CASCADE: remover a categoria remove as suas modalidades.';

-- A modalidade NÃO é global: unicidade dentro de (programa, categoria, slug).
-- Impede duplicação da mesma modalidade na mesma categoria/programa e, por
-- consequência, duplicação dentro da categoria (slug por categoria único).
create unique index if not exists award_modalities_program_category_slug_uidx
  on public.award_modalities (award_program_id, category_id, slug);

create index if not exists award_modalities_program_idx
  on public.award_modalities (award_program_id);
create index if not exists award_modalities_category_idx
  on public.award_modalities (category_id);
create index if not exists award_modalities_active_idx
  on public.award_modalities (active) where active = true;

drop trigger if exists award_modalities_touch on public.award_modalities;
create trigger award_modalities_touch before update on public.award_modalities
  for each row execute function public.touch_updated_at();

-- Coerência programa × categoria: a modalidade tem de pertencer ao mesmo
-- award_program da categoria (fail-closed, nada parcial).
create or replace function public.award_modalities_check_program()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category_program uuid;
begin
  select c.award_program_id into v_category_program
  from public.categories c
  where c.id = new.category_id;

  if not found then
    raise exception 'FASE5C38_COHERENCE: category_id % não existe.', new.category_id
      using errcode = '23503';
  end if;

  if v_category_program is distinct from new.award_program_id then
    raise exception 'FASE5C38_PROGRAM_MISMATCH: modalidade (programa=%) incompatível com a categoria % (programa=%). Cruzamento entre programas recusado.',
      new.award_program_id, new.category_id, v_category_program
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_award_modalities_check_program on public.award_modalities;
create trigger trg_award_modalities_check_program
  before insert or update of award_program_id, category_id on public.award_modalities
  for each row execute function public.award_modalities_check_program();

alter table public.award_modalities enable row level security;

drop policy if exists "public read award_modalities" on public.award_modalities;
drop policy if exists "anon read award_modalities" on public.award_modalities;
drop policy if exists "authenticated read award_modalities" on public.award_modalities;
drop policy if exists "admin manage award_modalities" on public.award_modalities;

-- Fundação 5C.3.8: gestão SOMENTE por admins (leitura pública de modalidades
-- ficará para fase posterior com policy dedicada; nesta fase fail-closed).
create policy "admin manage award_modalities" on public.award_modalities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- B) award_distinctions — distinção atribuída numa edição
-- --------------------------------------------------------------------------
-- Separa DEFINIÇÃO (award_modalities) de ATRIBUIÇÃO (esta tabela):
--   2026 × Braga × Restaurantes × Excelência no Atendimento → Empresa X
create table if not exists public.award_distinctions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  city_id uuid not null references public.cities (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  modality_id uuid not null references public.award_modalities (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Mérito (NUNCA misturado com estado comercial).
  award_status text not null default 'eligible'
    check (award_status in ('eligible','selected','winner','confirmed','cancelled')),
  -- Relação comercial (recusa NÃO altera mérito nem votos).
  commercial_status text not null default 'pending'
    check (commercial_status in ('pending','contacted','accepted','declined','confirmed','cancelled')),
  -- Origem auditável da distinção. `manual` = registo administrativo com
  -- auditoria — NUNCA manipulação de votes / vote_adjustments.
  source text not null default 'manual'
    check (source in ('general_vote','modality_vote','jury','editorial','manual')),
  position integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.award_distinctions is
  'FASE 5C.3.8: distinções atribuídas por edição (campanha × cidade × '
  'categoria × modalidade × empresa). Mérito (award_status) SEPARADO da '
  'relação comercial (commercial_status): commercial_status=declined NÃO '
  'transfere o 1.º lugar nem altera votes/vote_adjustments/ranking. '
  'source=manual significa registo administrativo auditado, nunca '
  'manipulação de votos. Sem algoritmo automático nesta fase.';

comment on column public.award_distinctions.award_status is
  'FASE 5C.3.8: estado do mérito (eligible|selected|winner|confirmed|cancelled). '
  'Independente da relação comercial.';

comment on column public.award_distinctions.commercial_status is
  'FASE 5C.3.8: estado comercial (pending|contacted|accepted|declined|confirmed|cancelled). '
  'declined NÃO altera mérito, votos ou ranking histórico.';

comment on column public.award_distinctions.source is
  'FASE 5C.3.8: origem da distinção (general_vote|modality_vote|jury|editorial|manual). '
  'manual = registo administrativo com auditoria; nunca manipula votes.';

-- Uma empresa recebe cada modalidade no máximo uma vez por
-- (edição × cidade × categoria). Múltiplas empresas por modalidade são
-- permitidas (sem vencedor automático nesta fase).
create unique index if not exists award_distinctions_edition_scope_uidx
  on public.award_distinctions (campaign_id, city_id, category_id, modality_id, business_id);

create index if not exists award_distinctions_campaign_idx
  on public.award_distinctions (campaign_id);
create index if not exists award_distinctions_modality_idx
  on public.award_distinctions (modality_id);
create index if not exists award_distinctions_business_idx
  on public.award_distinctions (business_id);
create index if not exists award_distinctions_lookup_idx
  on public.award_distinctions (campaign_id, city_id, category_id);

drop trigger if exists award_distinctions_touch on public.award_distinctions;
create trigger award_distinctions_touch before update on public.award_distinctions
  for each row execute function public.touch_updated_at();

-- Validação cruzada fail-closed (nada parcial):
--  1. modalidade.category_id = distinctions.category_id;
--  2. campanha / modalidade / categoria no MESMO award_program;
--  3. cidade no país do programa (cities.country_code = programas.country_code);
--  4. empresa estabelecida na cidade (businesses.city_id = distinctions.city_id).
create or replace function public.award_distinctions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_program uuid;
  v_modality_program uuid;
  v_modality_category uuid;
  v_category_program uuid;
  v_program_country text;
  v_city_country text;
  v_business_city uuid;
begin
  select c.award_program_id into v_campaign_program
  from public.campaigns c where c.id = new.campaign_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: campaign_id % não existe.', new.campaign_id
      using errcode = '23503';
  end if;

  select m.award_program_id, m.category_id into v_modality_program, v_modality_category
  from public.award_modalities m where m.id = new.modality_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: modality_id % não existe.', new.modality_id
      using errcode = '23503';
  end if;

  select c.award_program_id into v_category_program
  from public.categories c where c.id = new.category_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: category_id % não existe.', new.category_id
      using errcode = '23503';
  end if;

  -- 1. Modalidade pertence a outra categoria → recusa.
  if v_modality_category is distinct from new.category_id then
    raise exception 'FASE5C38_CATEGORY_MISMATCH: modalidade % pertence à categoria %, não a %.',
      new.modality_id, v_modality_category, new.category_id
      using errcode = '23514';
  end if;

  -- 2. Programas cruzados (campanha × modalidade × categoria) → recusa.
  if v_campaign_program is distinct from v_modality_program
     or v_campaign_program is distinct from v_category_program then
    raise exception 'FASE5C38_PROGRAM_MISMATCH: campanha (programa=%) × modalidade (programa=%) × categoria (programa=%) incompatíveis. Cruzamento entre programas recusado.',
      v_campaign_program, v_modality_program, v_category_program
      using errcode = '23514';
  end if;

  -- 3. Cidade de outro país/programa → recusa.
  select p.country_code into v_program_country
  from public.award_programs p where p.id = v_campaign_program;
  select ci.country_code into v_city_country
  from public.cities ci where ci.id = new.city_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: city_id % não existe.', new.city_id
      using errcode = '23503';
  end if;
  if v_city_country is distinct from v_program_country then
    raise exception 'FASE5C38_COUNTRY_MISMATCH: cidade % (país=%) fora do país do programa (%).',
      new.city_id, v_city_country, v_program_country
      using errcode = '23514';
  end if;

  -- 4. Empresa fora da cidade → recusa (country_code deriva de city_id).
  select b.city_id into v_business_city
  from public.businesses b where b.id = new.business_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: business_id % não existe.', new.business_id
      using errcode = '23503';
  end if;
  if v_business_city is distinct from new.city_id then
    raise exception 'FASE5C38_CITY_MISMATCH: empresa % estabelecida na cidade %, não em %.',
      new.business_id, v_business_city, new.city_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_award_distinctions_validate on public.award_distinctions;
create trigger trg_award_distinctions_validate
  before insert or update of campaign_id, city_id, category_id, modality_id, business_id
  on public.award_distinctions
  for each row execute function public.award_distinctions_validate();

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
create or replace function public.award_distinctions_audit()
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
      case when TG_OP = 'INSERT' then 'award_distinction.created' else 'award_distinction.updated' end,
      'award_distinctions',
      new.id::text,
      jsonb_build_object(
        'campaign_id', new.campaign_id,
        'city_id', new.city_id,
        'category_id', new.category_id,
        'modality_id', new.modality_id,
        'business_id', new.business_id,
        'award_status', new.award_status,
        'commercial_status', new.commercial_status,
        'source', new.source
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_award_distinctions_audit on public.award_distinctions;
create trigger trg_award_distinctions_audit
  after insert or update on public.award_distinctions
  for each row execute function public.award_distinctions_audit();

-- Rasto de modalidades em audit_logs (best-effort, mesma convenção).
create or replace function public.award_modalities_audit()
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
      case
        when TG_OP = 'INSERT' then 'award_modality.created'
        when TG_OP = 'DELETE' then 'award_modality.deleted'
        else 'award_modality.updated'
      end,
      'award_modalities',
      coalesce(new.id::text, old.id::text),
      jsonb_build_object(
        'name', coalesce(new.name, old.name),
        'award_program_id', coalesce(new.award_program_id, old.award_program_id),
        'category_id', coalesce(new.category_id, old.category_id)
      )
    );
  exception when others then
    null;
  end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_award_modalities_audit on public.award_modalities;
create trigger trg_award_modalities_audit
  after insert or update or delete on public.award_modalities
  for each row execute function public.award_modalities_audit();

alter table public.award_distinctions enable row level security;

drop policy if exists "public read award_distinctions" on public.award_distinctions;
drop policy if exists "anon read award_distinctions" on public.award_distinctions;
drop policy if exists "authenticated read award_distinctions" on public.award_distinctions;
drop policy if exists "admin manage award_distinctions" on public.award_distinctions;
drop policy if exists "admin read award_distinctions" on public.award_distinctions;
drop policy if exists "admin write award_distinctions" on public.award_distinctions;

-- Fundação 5C.3.8: gestão SOMENTE por admins; sem UPDATE/DELETE directo por
-- omissão para outros roles (RLS nega). Sem exposição pública nesta fase.
create policy "admin manage award_distinctions" on public.award_distinctions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- C) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_bad_modality_program bigint;
  v_bad_distinction_program bigint;
  v_bad_distinction_country bigint;
  v_bad_distinction_city bigint;
  v_bad_distinction_category bigint;
begin
  -- C1. Nenhuma modalidade com programa divergente da categoria.
  select count(*) into v_bad_modality_program
  from public.award_modalities m
  join public.categories c on c.id = m.category_id
  where c.award_program_id is distinct from m.award_program_id;
  if v_bad_modality_program > 0 then
    raise exception 'FASE5C38_VALIDATION_FAILED: % modalidades com programa divergente da categoria', v_bad_modality_program;
  end if;

  -- C2. Nenhuma distinção com (campanha × modalidade × categoria) cruzados.
  select count(*) into v_bad_distinction_program
  from public.award_distinctions d
  join public.campaigns cam on cam.id = d.campaign_id
  join public.award_modalities m on m.id = d.modality_id
  join public.categories cat on cat.id = d.category_id
  where cam.award_program_id is distinct from m.award_program_id
     or cam.award_program_id is distinct from cat.award_program_id
     or m.category_id is distinct from d.category_id;
  if v_bad_distinction_program > 0 then
    raise exception 'FASE5C38_VALIDATION_FAILED: % distinções com programa/categoria cruzados', v_bad_distinction_program;
  end if;

  -- C3. Nenhuma distinção com cidade fora do país do programa.
  select count(*) into v_bad_distinction_country
  from public.award_distinctions d
  join public.campaigns cam on cam.id = d.campaign_id
  join public.award_programs p on p.id = cam.award_program_id
  join public.cities ci on ci.id = d.city_id
  where ci.country_code is distinct from p.country_code;
  if v_bad_distinction_country > 0 then
    raise exception 'FASE5C38_VALIDATION_FAILED: % distinções com cidade fora do país do programa', v_bad_distinction_country;
  end if;

  -- C4. Nenhuma distinção com empresa fora da cidade.
  select count(*) into v_bad_distinction_city
  from public.award_distinctions d
  join public.businesses b on b.id = d.business_id
  where b.city_id is distinct from d.city_id;
  if v_bad_distinction_city > 0 then
    raise exception 'FASE5C38_VALIDATION_FAILED: % distinções com empresa fora da cidade', v_bad_distinction_city;
  end if;

  -- C5. Listas de valores íntegras (defesa contra edição manual inválida).
  select count(*) into v_bad_distinction_category
  from public.award_distinctions d
  where d.source not in ('general_vote','modality_vote','jury','editorial','manual')
     or d.award_status not in ('eligible','selected','winner','confirmed','cancelled')
     or d.commercial_status not in ('pending','contacted','accepted','declined','confirmed','cancelled');
  if v_bad_distinction_category > 0 then
    raise exception 'FASE5C38_VALIDATION_FAILED: % distinções com source/status inválidos', v_bad_distinction_category;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments nem redefinir RPCs de
-- apuramento. Verificação textual fail-closed sobre o próprio esquema
-- (protege contra edição acidental futura antes do COMMIT).
-- (Implementada como comentário estrutural auditável; a prova executável
--  vive em scripts/verify-phase5c38.mjs que inspecciona este ficheiro.)

COMMIT;
