-- ============================================================================
-- THE BEST EUROPA — FASE 6.1 (PILOTO PORTUGAL)
-- Migração 0018: GESTÃO DE CONVITES E ACEITAÇÃO DE PARTICIPANTES (PRÉ-VOTAÇÃO)
--
-- DIAGNÓSTICO (auditoria antes de escrever):
--  - 0001 criou campaign_entries (id, campaign_id, city_id, category_id,
--    business_id, active, featured, position, UNIQUE
--    (campaign_id, city_id, category_id, business_id), RLS com leitura
--    pública de entries activos + gestão admin, trigger entries_touch).
--  - 0005/0009/0010 criaram o motor eleitoral: votes (UNIQUE
--    campaign+city+category+ip_hash, SEM insert público), vote_attempts,
--    vote_adjustments (imutável) + RPCs get_admin_tally /
--    get_published_results*. NADA disto é tocado aqui.
--  - 0011/0012 criaram fundação multi-country: award_programs, campaigns.
--    award_program_id, site_settings por programa. Isolamento por programa
--    preservado (convites resolvem programa via campaigns.award_program_id).
--  - 0014 criou award_modalities + award_distinctions (mérito vs comercial
--    separados, RLS admin-only, triggers de auditoria best-effort para
--    audit_logs). 0015 criou modality_votes (tabela SEPARADA de votes).
--    0016 criou distinction_fulfillment. 0017 criou digital_credentials +
--    RPC pública verify_digital_credential (única superfície pública nova).
--  - Estrutura encontrada: NENHUMA tabela de pré-votação / convite /
--    contacto / aceitação existe (pesquisado em todas as migrations 0001–
--    0017 e em src/lib + src/pages/admin). campaign_entries é a estrutura
--    EFETIVA da participação (lida pela votação pública e pelo apuramento).
--  - Estrutura reutilizada: campaigns, cities, categories, businesses,
--    campaign_entries (FK + UNIQUE como barreira final), audit_logs
--    (auditoria), public.is_admin() (RLS admin-only),
--    public.touch_updated_at().
--  - Necessidade de migration: SIM — nova tabela autónoma
--    participant_invitations para o processo PRÉ-VOTAÇÃO, SEM alterar
--    nenhuma tabela existente, SEM tocar no resultado eleitoral.
--
-- MODELO CONCEITUAL (pré-votação SEPARADA da participação efetiva):
--  1. CONVITE (participant_invitations, NOVA, esta tabela): processo
--     operacional potential → contacted → accepted → confirmed, mais
--     declined (saída lateral). Regista forma de contacto, pessoa de
--     contacto (interna), notas (internas) e referência simples de aceitação.
--     SEM ficheiros/screenshots nesta fase.
--  2. PARTICIPAÇÃO EFETIVA (campaign_entries, EXISTENTE, intocada): só é
--     criada/associada no momento da confirmação para votação, de forma
--     IDEMPOTENTE (UNIQUE existente impede duplicados; aplicação faz
--     SELECT-then-INSERT e trata 23505 como "já existe").
--  Contactar ≠ aceitar ≠ confirmar. A confirmação exige estado anterior
--  accepted e regista campaign_entry_id + confirmed_at + audit log.
--
-- REGRA DE NEGÓCIO (piloto Braga, ~30 categorias, 3–5 confirmados/categoria):
--  - Participação na votação é GRATUITA. Aceitação não implica obrigação de
--    compra posterior. Depois de iniciada a votação, a participação é
--    considerada confirmada para aquela edição.
--  - NENHUM bloqueio automático de mínimo de 3 nesta fase — apenas
--    contadores/resumo por categoria (calculados na aplicação, sem colunas
--    eleitorais persistidas aqui).
--
-- ESCOPO (SÓ pré-votação, SEM monetização, SEM seeds):
--  A) participant_invitations — UM registo POR
--     (campaign_id, city_id, category_id, business_id):
--     status potential|contacted|accepted|declined|confirmed,
--     contacted_at, accepted_at, declined_at, confirmed_at,
--     contact_method phone|whatsapp|email|in_person|other (NULL até ao
--     primeiro contacto), contact_person (interno), notes (interno),
--     acceptance_reference (opcional, texto simples),
--     campaign_entry_id (FK opcional → campaign_entries, preenchida na
--     confirmação), created_by/updated_by (profiles.id, NULL se removido),
--     created_at/updated_at.
--  B) RLS admin-only via public.is_admin(). SEM policy para anon. SEM
--     SELECT/INSERT/UPDATE/DELETE públicos. A página pública de votação
--     continua a ler APENAS campaign_entries/vistas públicas existentes.
--  C) Auditoria best-effort em audit_logs (trigger, nunca bloqueia a
--     escrita): participant_invitation.created/.contacted/.accepted/
--     .declined/.confirmed/.updated.
--  - NÃO cria campaign_entry ao contactar/aceitar (só ao confirmar).
--  - NÃO copia votos, posição ou ranking (zero colunas eleitorais).
--  - NÃO cria Stripe/checkout/preços/faturação/pagamentos/encomendas.
--  - NÃO cria seeds, cidades, categorias, 2027, países ou programas.
--  - NÃO altera votes / vote_attempts / vote_adjustments / modality_votes /
--    modality_vote_attempts / campaign_entries / award_* / fulfillment /
--    digital_credentials nem redefine RPCs de apuramento/verificação.
--  - NÃO executa remotamente — ficheiro local para revisão humana.
--
-- GARANTIAS: transacional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (IF NOT EXISTS + DROP IF EXISTS antes de CREATE), fail-closed
-- (FK + CHECKs + validações finais abortam o COMMIT), RLS admin-only via
-- public.is_admin(), sem policy para anon. Sem service role no frontend.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) participant_invitations — processo PRÉ-VOTAÇÃO (convite e aceitação)
-- --------------------------------------------------------------------------
create table if not exists public.participant_invitations (
  id uuid primary key default gen_random_uuid(),
  -- Âmbito operacional (os 4 eixos que definem "quem × onde × em quê × quando").
  campaign_id uuid not null
    references public.campaigns (id) on delete cascade,
  city_id uuid not null
    references public.cities (id) on delete cascade,
  category_id uuid not null
    references public.categories (id) on delete cascade,
  business_id uuid not null
    references public.businesses (id) on delete cascade,
  -- Estado operacional do funil pré-votação.
  --  potential = Potencial · contacted = Contactada ·
  --  accepted = Aceitou participar · declined = Recusou ·
  --  confirmed = Confirmada para votação
  status text not null default 'potential'
    check (status in ('potential','contacted','accepted','declined','confirmed')),
  -- Marcos temporais (preenchidos pela aplicação nas transições; confirm
  -- exige accepted prévio — ver função auxiliar abaixo + lógica de app).
  contacted_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  confirmed_at timestamptz,
  -- Forma do contacto (NULL enquanto potential; obrigatória a partir de
  -- contacted na lógica de aplicação — CHECK permite NULL para não
  -- bloquear importações/backfills administrativos de potenciais).
  contact_method text
    check (contact_method is null or contact_method in ('phone','whatsapp','email','in_person','other')),
  -- Dados INTERNOS (nunca expostos publicamente; sem RLS pública nesta tabela).
  contact_person text,
  notes text,
  -- Referência simples da prova/forma de aceitação (texto livre opcional).
  -- NÃO armazena ficheiros nem screenshots nesta fase.
  acceptance_reference text,
  -- Ligação idempotente à participação efetiva (preenchida SOMENTE na
  -- confirmação; NULL antes disso). ON DELETE SET NULL preserva o rasto
  -- do convite mesmo se a entry for removida pelo fluxo Phase-3 guard.
  campaign_entry_id uuid null
    references public.campaign_entries (id) on delete set null,
  -- Responsáveis administrativos (NULL se o perfil foi removido).
  created_by uuid null
    references public.profiles (id) on delete set null,
  updated_by uuid null
    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Coerência de estados: cada marco exige o estado correspondente já
  -- alcançado (permite re-contacto: contacted_at persiste após aceitar).
  -- confirmed exige campaign_entry_id (a app cria/associa a entry primeiro).
  check (
    (contacted_at is null or status in ('contacted','accepted','confirmed'))
    and (accepted_at is null or status in ('accepted','confirmed'))
    and (declined_at is null or status = 'declined')
    and (confirmed_at is null or status = 'confirmed')
    and (status <> 'confirmed' or (confirmed_at is not null and campaign_entry_id is not null))
    and (status <> 'declined' or declined_at is not null)
  )
);

comment on table public.participant_invitations is
  'FASE 6.1 (piloto Portugal): funil PRÉ-VOTAÇÃO de convites — potential | '
  'contacted | accepted | declined | confirmed. Camada SEPARADA da '
  'participação efetiva (campaign_entries): contactar/aceitar NUNCA cria '
  'entry; confirmar cria/associa entry de forma idempotente e regista '
  'campaign_entry_id + confirmed_at + audit log. Participação gratuita; '
  'aceitação sem obrigação de compra. UM registo POR '
  '(campaign, city, category, business). Contactos/notas/referência são '
  'internos (RLS admin-only, sem exposição pública). NUNCA altera votos, '
  'ranking, resultados, distinções, fulfillment ou credenciais digitais.';

comment on column public.participant_invitations.status is
  'FASE 6.1: estado operacional — potential (Potencial) | contacted '
  '(Contactada) | accepted (Aceitou participar) | declined (Recusou) | '
  'confirmed (Confirmada para votação). Transições válidas aplicadas na '
  'aplicação: potential→contacted→accepted→confirmed; '
  'contacted→declined; accepted→declined (desistência); declined→contacted '
  '(re-contacto, limpa declined_at). confirmed é TERMINAL (sem regresso).';

comment on column public.participant_invitations.acceptance_reference is
  'FASE 6.1: referência simples opcional da prova/forma de aceitação '
  '(texto). NÃO armazena ficheiros nem screenshots nesta fase.';

comment on column public.participant_invitations.campaign_entry_id is
  'FASE 6.1: participação efetiva associada na confirmação (idempotente — '
  'reutiliza entry compatível existente em vez de duplicar). NULL até à '
  'confirmação. ON DELETE SET NULL preserva o rasto do convite.';

-- UM registo por (edição × cidade × categoria × empresa): impede convites
-- duplicados para o mesmo alvo; a BD é a barreira final (a app verifica antes).
create unique index if not exists participant_invitations_scope_uidx
  on public.participant_invitations (campaign_id, city_id, category_id, business_id);

create index if not exists participant_invitations_campaign_idx
  on public.participant_invitations (campaign_id);
create index if not exists participant_invitations_city_idx
  on public.participant_invitations (city_id);
create index if not exists participant_invitations_category_idx
  on public.participant_invitations (category_id);
create index if not exists participant_invitations_business_idx
  on public.participant_invitations (business_id);
create index if not exists participant_invitations_status_idx
  on public.participant_invitations (status);
create index if not exists participant_invitations_entry_idx
  on public.participant_invitations (campaign_entry_id)
  where campaign_entry_id is not null;

drop trigger if exists participant_invitations_touch on public.participant_invitations;
create trigger participant_invitations_touch before update on public.participant_invitations
  for each row execute function public.touch_updated_at();

-- Coerência programa × cidade × categoria × campanha (fail-closed):
-- a campanha pertence a um award_program; a categoria pertence ao MESMO
-- programa; a cidade pertence ao país do programa. Recusa cruzamentos.
create or replace function public.participant_invitations_check_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_campaign_program uuid;
  v_program_country text;
  v_category_program uuid;
  v_city_country text;
begin
  select c.award_program_id into v_campaign_program
  from public.campaigns c
  where c.id = new.campaign_id;
  if not found then
    raise exception 'FASE61_SCOPE: campaign_id % não existe.', new.campaign_id
      using errcode = '23503';
  end if;

  select p.country_code into v_program_country
  from public.award_programs p
  where p.id = v_campaign_program;
  if not found then
    raise exception 'FASE61_SCOPE: programa % da campanha % não existe.', v_campaign_program, new.campaign_id
      using errcode = '23503';
  end if;

  select c.award_program_id into v_category_program
  from public.categories c
  where c.id = new.category_id;
  if not found then
    raise exception 'FASE61_SCOPE: category_id % não existe.', new.category_id
      using errcode = '23503';
  end if;
  if v_category_program is distinct from v_campaign_program then
    raise exception 'FASE61_PROGRAM_MISMATCH: categoria % (programa=%) incompatível com a campanha % (programa=%). Cruzamento entre programas recusado.',
      new.category_id, v_category_program, new.campaign_id, v_campaign_program
      using errcode = '23514';
  end if;

  select ci.country_code into v_city_country
  from public.cities ci
  where ci.id = new.city_id;
  if not found then
    raise exception 'FASE61_SCOPE: city_id % não existe.', new.city_id
      using errcode = '23503';
  end if;
  if v_city_country is distinct from v_program_country then
    raise exception 'FASE61_COUNTRY_MISMATCH: cidade % (país=%) fora do país do programa (%).',
      new.city_id, v_city_country, v_program_country
      using errcode = '23514';
  end if;

  -- campaign_entry_id, quando preenchido, tem de ser compatível
  -- (mesma edição × cidade × categoria × empresa) — defesa contra
  -- associação cruzada acidental.
  if new.campaign_entry_id is not null then
    perform 1
    from public.campaign_entries e
    where e.id = new.campaign_entry_id
      and e.campaign_id = new.campaign_id
      and e.city_id = new.city_id
      and e.category_id = new.category_id
      and e.business_id = new.business_id;
    if not found then
      raise exception 'FASE61_ENTRY_MISMATCH: campaign_entry_id % incompatível com o âmbito do convite (edição × cidade × categoria × empresa).',
        new.campaign_entry_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_participant_invitations_check_scope on public.participant_invitations;
create trigger trg_participant_invitations_check_scope
  before insert or update on public.participant_invitations
  for each row execute function public.participant_invitations_check_scope();

-- Rasto em audit_logs (best-effort, mesma convenção das fases 5C):
-- participant_invitation.created/.contacted/.accepted/.declined/
-- .confirmed/.updated. Nunca bloqueia a escrita (exception → null).
create or replace function public.participant_invitations_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  begin
    if TG_OP = 'INSERT' then
      v_action := 'participant_invitation.created';
    elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
      case new.status
        when 'contacted' then v_action := 'participant_invitation.contacted';
        when 'accepted' then v_action := 'participant_invitation.accepted';
        when 'declined' then v_action := 'participant_invitation.declined';
        when 'confirmed' then v_action := 'participant_invitation.confirmed';
        else v_action := 'participant_invitation.updated';
      end case;
    else
      v_action := 'participant_invitation.updated';
    end if;
    insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
    values (
      auth.uid(),
      v_action,
      'participant_invitations',
      new.id::text,
      jsonb_build_object(
        'campaign_id', new.campaign_id,
        'city_id', new.city_id,
        'category_id', new.category_id,
        'business_id', new.business_id,
        'status', new.status,
        'contact_method', new.contact_method,
        'campaign_entry_id', new.campaign_entry_id
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_participant_invitations_audit on public.participant_invitations;
create trigger trg_participant_invitations_audit
  after insert or update on public.participant_invitations
  for each row execute function public.participant_invitations_audit();

alter table public.participant_invitations enable row level security;

drop policy if exists "public read participant_invitations" on public.participant_invitations;
drop policy if exists "anon read participant_invitations" on public.participant_invitations;
drop policy if exists "authenticated read participant_invitations" on public.participant_invitations;
drop policy if exists "admin manage participant_invitations" on public.participant_invitations;
drop policy if exists "admin read participant_invitations" on public.participant_invitations;
drop policy if exists "admin write participant_invitations" on public.participant_invitations;

-- FASE 6.1: gestão SOMENTE por admins; sem exposição pública nesta fase.
-- contact_person / notes / acceptance_reference são internos — nenhuma
-- policy pública os expõe; a votação pública continua a ler APENAS as
-- estruturas públicas existentes (campaign_entries e vistas/RPCs atuais).
create policy "admin manage participant_invitations" on public.participant_invitations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- B) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_bad_scope bigint;
  v_bad_status bigint;
  v_bad_method bigint;
  v_bad_confirmed bigint;
begin
  -- B1. Nenhum convite com programa/cidade/categoria cruzados.
  select count(*) into v_bad_scope
  from public.participant_invitations pi
  join public.campaigns cam on cam.id = pi.campaign_id
  join public.award_programs p on p.id = cam.award_program_id
  join public.categories cat on cat.id = pi.category_id
  join public.cities ci on ci.id = pi.city_id
  where cat.award_program_id is distinct from cam.award_program_id
     or ci.country_code is distinct from p.country_code;
  if v_bad_scope > 0 then
    raise exception 'FASE61_VALIDATION_FAILED: % convites com programa/cidade/categoria cruzados', v_bad_scope;
  end if;

  -- B2. Listas de valores íntegras.
  select count(*) into v_bad_status
  from public.participant_invitations pi
  where pi.status not in ('potential','contacted','accepted','declined','confirmed');
  if v_bad_status > 0 then
    raise exception 'FASE61_VALIDATION_FAILED: % convites com status inválido', v_bad_status;
  end if;

  select count(*) into v_bad_method
  from public.participant_invitations pi
  where pi.contact_method is not null
    and pi.contact_method not in ('phone','whatsapp','email','in_person','other');
  if v_bad_method > 0 then
    raise exception 'FASE61_VALIDATION_FAILED: % convites com contact_method inválido', v_bad_method;
  end if;

  -- B3. Nenhum confirmed sem entry + confirmed_at; nenhum declined sem declined_at.
  select count(*) into v_bad_confirmed
  from public.participant_invitations pi
  where (pi.status = 'confirmed' and (pi.campaign_entry_id is null or pi.confirmed_at is null))
     or (pi.status = 'declined' and pi.declined_at is null);
  if v_bad_confirmed > 0 then
    raise exception 'FASE61_VALIDATION_FAILED: % convites confirmed/declined incoerentes', v_bad_confirmed;
  end if;

  -- B4. Nenhuma entry associada cruzada (defesa em profundidade).
  perform 1
  from public.participant_invitations pi
  join public.campaign_entries e on e.id = pi.campaign_entry_id
  where e.campaign_id is distinct from pi.campaign_id
     or e.city_id is distinct from pi.city_id
     or e.category_id is distinct from pi.category_id
     or e.business_id is distinct from pi.business_id;
  if found then
    raise exception 'FASE61_VALIDATION_FAILED: existe convite com campaign_entry_id cruzado';
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments / modality_votes /
-- modality_vote_attempts nem redefinir RPCs de apuramento/verificação, nem
-- ALTER/DROP em tabelas anteriores. A prova executável vive em
-- scripts/verify-phase61.mjs que inspeciona este ficheiro.

COMMIT;
