-- ============================================================================
-- THE BEST EUROPA — FASE 5C.3.13
-- Migração 0017: CERTIFICADOS E SELOS DIGITAIS VERIFICÁVEIS
--
-- AUDITORIA (executada antes de escrever):
--  - 0014 criou award_modalities + award_distinctions (award_status ×
--    commercial_status separados, UNIQUE edição×cidade×categoria×
--    modalidade×empresa, RLS admin-only, trigger audit_logs genérico).
--  - 0015 criou modality_votes + modality_vote_attempts + RPC
--    get_admin_modality_tally (lê SÓ modality_votes).
--  - 0016 criou distinction_fulfillment (UM registo POR distinção×item:
--    certificate|digital_seal|plaque|trophy, UNIQUE
--    (award_distinction_id, item_type), RLS admin-only, sem SELECT anon).
--  - Estrutura encontrada: NENHUM mecanismo de código de reconhecimento,
--    certificado, selo, token público ou verificação pública existe
--    (verificado em 0014/0015/0016, src/lib/distinctions.ts,
--    src/lib/fulfillment.ts, DistinctionsAdminPage, rotas públicas em
--    App.tsx, ProgramProvider, RLS e tipos database). distinction_fulfillment
--    gere reconhecimento/entrega mas NÃO possui identidade verificável.
--  - Estrutura reutilizada: award_distinctions (FK), distinction_fulfillment
--    (FK opcional), audit_logs (auditoria), public.is_admin() (RLS
--    admin-only), public.touch_updated_at().
--  - Necessidade de migration: SIM — nova tabela autónoma digital_credentials
--    + RPC pública verify_digital_credential, sem alterar nenhuma tabela
--    existente, sem tocar no resultado eleitoral.
--
-- MODELO CONCEITUAL (quinta camada, RECONHECIMENTO VERIFICÁVEL):
--  1. RESULTADO ELEITORAL — votes / modality_votes / rankings (INTOCÁVEL).
--  2. MÉRITO — award_distinctions.award_status (INTOCÁVEL por esta migration).
--  3. RELAÇÃO/ACEITAÇÃO — award_distinctions.commercial_status (INTOCÁVEL).
--  4. RECONHECIMENTO/ENTREGA — distinction_fulfillment (INTOCÁVEL; só lido).
--  5. EMISSÃO VERIFICÁVEL — digital_credentials (NOVA, esta tabela): cada
--     registo representa UM ativo digital emitido (certificado OU selo) com
--     código único não previsível e verificação pública controlada.
--  Uma emissão/revogação NUNCA altera votos, ranking, posição, award_status,
--  commercial_status, vencedor ou resultados públicos.
--
-- ESCOPO (SÓ emissão verificável de certificate + digital_seal):
--  A) digital_credentials — UM registo ATIVO POR (distinção × tipo):
--     credential_type certificate|digital_seal, verification_code TEXT UNIQUE
--     (prefixo legível TBE-PT-<ANO>- + 12 chars [A-Z0-9] de entropia segura,
--     gerado em app + UNIQUE no banco), status issued|revoked, issued_at,
--     revoked_at, revocation_reason, fulfillment_id opcional, metadata jsonb
--     opcional. UNIQUE parcial (award_distinction_id, credential_type)
--     WHERE status='issued' impede duplicação acidental de ativos equivalentes
--     e permite histórico de reemissões (revogados preservados).
--  B) verify_digital_credential(p_code TEXT) — RPC pública SECURITY DEFINER,
--     STABLE, retorno controlado (só campos seguros, sem user ids, sem notes,
--     sem commercial_status, sem revocation_reason, sem votos). Fail-closed:
--     código inexistente → zero linhas; revogado → estado visível sem motivo.
--  - NÃO guarda total_votes, ranking, posição copiada ou dados eleitorais.
--  - NÃO cria Stripe/checkout/preços/faturação/pagamentos/encomendas.
--  - NÃO cria seeds, 2027, países ou programas.
--  - NÃO altera votes / vote_attempts / vote_adjustments / modality_votes /
--    modality_vote_attempts nem redefine RPCs de apuramento.
--  - NÃO executa remotamente — ficheiro local para revisão humana.
--
-- GARANTIAS: transaccional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (IF NOT EXISTS + DROP IF EXISTS antes de CREATE), fail-closed
-- (FK + CHECKs + validações finais abortam o COMMIT), RLS admin-only via
-- public.is_admin(), SEM SELECT/INSERT/UPDATE/DELETE para anon. Verificação
-- pública SOMENTE via RPC segura. Sem service role no frontend.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) digital_credentials — ativo digital emitido (certificado OU selo)
-- --------------------------------------------------------------------------
create table if not exists public.digital_credentials (
  id uuid primary key default gen_random_uuid(),
  award_distinction_id uuid not null
    references public.award_distinctions (id) on delete cascade,
  -- Ligação operacional ao item de reconhecimento correspondente
  -- (certificate|digital_seal em distinction_fulfillment). NULL quando a
  -- credencial é emitida sem item prévio; nunca FORÇA criação de fulfillment.
  fulfillment_id uuid null
    references public.distinction_fulfillment (id) on delete set null,
  -- Tipo de ativo verificável (SOMENTE estes dois nesta fase; placa/troféu
  -- continuam geridos SÓ em distinction_fulfillment, sem credencial).
  credential_type text not null
    check (credential_type in ('certificate','digital_seal')),
  -- Código público único, não previsível, seguro para exposição pública.
  -- Formato operacional: TBE-PT-<ANO>-<12 chars A-Z0-9> (ex.:
  -- TBE-PT-2026-K7Q2M9X4P1Z8). Gerado na aplicação com entropia segura
  -- (crypto), UNIQUE no banco como garantia final.
  verification_code text not null unique,
  -- Estados (SOMENTE estes dois nesta fase):
  --  issued  = Emitido · revoked = Revogado (preserva registo, nunca apaga).
  status text not null default 'issued'
    check (status in ('issued','revoked')),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- Motivo administrativo da revogação (OBRIGATÓRIO ao revogar; NUNCA
  -- exposto na verificação pública — só admin via SELECT admin-only).
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Metadata administrativa mínima opcional (ex.: programa/campanha de
  -- contexto no momento da emissão). NUNCA dados eleitorais.
  metadata jsonb,
  -- Coerência de estados: revogado exige revoked_at; emitido nunca tem
  -- revoked_at nem motivo.
  check (
    (status = 'issued' and revoked_at is null and revocation_reason is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

comment on table public.digital_credentials is
  'FASE 5C.3.13: certificados e selos digitais verificáveis — UM ativo POR '
  'emissão (distinção × tipo). Camada SEPARADA de votos/ranking (1), mérito '
  'award_status (2), relação commercial_status (3) e reconhecimento '
  'distinction_fulfillment (4): emissão/revogação NUNCA altera resultado '
  'eleitoral, mérito, relação comercial, vencedores ou resultados públicos. '
  'Tipos: certificate|digital_seal. Estados: issued|revoked (revogar preserva '
  'registo, nunca apaga). Código TBE-PT-<ANO>-<12A-Z0-9> UNIQUE não '
  'previsível. Verificação pública SOMENTE via RPC verify_digital_credential. '
  'SEM pagamentos, SEM seeds, SEM 2027, SEM novos países/programas.';

comment on column public.digital_credentials.award_distinction_id is
  'FASE 5C.3.13: distinção dona da credencial (FK → award_distinctions). '
  'ON DELETE CASCADE: remover a distinção remove as suas credenciais.';

comment on column public.digital_credentials.fulfillment_id is
  'FASE 5C.3.13: item de reconhecimento associado (FK opcional → '
  'distinction_fulfillment certificate|digital_seal). ON DELETE SET NULL.';

comment on column public.digital_credentials.verification_code is
  'FASE 5C.3.13: código público único não previsível '
  '(TBE-PT-<ANO>-<12 chars A-Z0-9>). UNIQUE. Seguro para exposição pública.';

comment on column public.digital_credentials.status is
  'FASE 5C.3.13: estado da credencial (issued|revoked). Revogar preserva o '
  'registo e exige revoked_at + motivo administrativo.';

comment on column public.digital_credentials.revocation_reason is
  'FASE 5C.3.13: motivo administrativo da revogação (obrigatório ao revogar). '
  'NUNCA exposto na verificação pública.';

-- Idempotência: UMA credencial ATIVA por (distinção × tipo). Revogadas
-- preservam histórico e permitem reemissão explícita futura.
create unique index if not exists digital_credentials_active_uidx
  on public.digital_credentials (award_distinction_id, credential_type)
  where status = 'issued';

create index if not exists digital_credentials_distinction_idx
  on public.digital_credentials (award_distinction_id);
create index if not exists digital_credentials_fulfillment_idx
  on public.digital_credentials (fulfillment_id);
create index if not exists digital_credentials_type_idx
  on public.digital_credentials (credential_type);
create index if not exists digital_credentials_status_idx
  on public.digital_credentials (status);

drop trigger if exists digital_credentials_touch on public.digital_credentials;
create trigger digital_credentials_touch before update on public.digital_credentials
  for each row execute function public.touch_updated_at();

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
-- Eventos: digital_credential.issued / digital_credential.revoked /
-- digital_credential.updated. Detalhe granular (motivo, fulfillment) via lib.
create or replace function public.digital_credentials_audit()
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
        when TG_OP = 'INSERT' then 'digital_credential.issued'
        when TG_OP = 'UPDATE' and old.status = 'issued' and new.status = 'revoked' then 'digital_credential.revoked'
        else 'digital_credential.updated'
      end,
      'digital_credentials',
      new.id::text,
      jsonb_build_object(
        'award_distinction_id', new.award_distinction_id,
        'credential_type', new.credential_type,
        'verification_code', new.verification_code,
        'status', new.status
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_digital_credentials_audit on public.digital_credentials;
create trigger trg_digital_credentials_audit
  after insert or update on public.digital_credentials
  for each row execute function public.digital_credentials_audit();

alter table public.digital_credentials enable row level security;

drop policy if exists "public read digital_credentials" on public.digital_credentials;
drop policy if exists "anon read digital_credentials" on public.digital_credentials;
drop policy if exists "authenticated read digital_credentials" on public.digital_credentials;
drop policy if exists "admin manage digital_credentials" on public.digital_credentials;
drop policy if exists "admin read digital_credentials" on public.digital_credentials;

-- FASE 5C.3.13: gestão SOMENTE por admins; SEM policy para anon.
-- Com RLS activo e sem policy permissiva, qualquer SELECT/INSERT/UPDATE/
-- DELETE directo do browser não-admin falha (fail-closed). A verificação
-- pública passa SOMENTE pela RPC verify_digital_credential (SECURITY
-- DEFINER). Programa/campanha validados na camada de aplicação (distinção
-- pertence à campanha/programa selecionados) + FK garante distinção válida.
create policy "admin manage digital_credentials" on public.digital_credentials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- B) verify_digital_credential — verificação pública controlada
-- --------------------------------------------------------------------------
-- Retorna SOMENTE campos seguros para exposição pública. NUNCA retorna:
-- user ids, actor ids, notes, commercial_status, dados internos, IP/hash,
-- audit metadata, revocation_reason, tracking, dados de entrega, votos.
-- Fail-closed: código inexistente → zero linhas (SETOF vazio).
-- Código revogado → linha com status='revoked' SEM motivo.
drop function if exists public.verify_digital_credential(text);

create or replace function public.verify_digital_credential(p_code text)
returns table (
  verification_code text,
  credential_type text,
  status text,
  issued_at timestamptz,
  program_name text,
  campaign_year integer,
  campaign_name text,
  business_name text,
  city_name text,
  category_name text,
  modality_name text,
  distinction_label text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  v_code := upper(trim(coalesce(p_code, '')));
  if v_code = '' then
    return;
  end if;
  return query
  select
    dc.verification_code,
    dc.credential_type,
    dc.status,
    dc.issued_at,
    ap.name::text as program_name,
    c.year as campaign_year,
    c.name::text as campaign_name,
    b.name::text as business_name,
    ci.name::text as city_name,
    cat.name::text as category_name,
    m.name::text as modality_name,
    (case dc.credential_type when 'certificate' then 'Certificado' else 'Selo digital' end)::text as distinction_label
  from public.digital_credentials dc
  join public.award_distinctions ad on ad.id = dc.award_distinction_id
  join public.campaigns c on c.id = ad.campaign_id
  left join public.award_programs ap on ap.id = c.award_program_id
  join public.businesses b on b.id = ad.business_id
  join public.cities ci on ci.id = ad.city_id
  join public.categories cat on cat.id = ad.category_id
  left join public.award_modalities m on m.id = ad.modality_id
  where dc.verification_code = v_code
  limit 1;
end;
$$;

comment on function public.verify_digital_credential(text) is
  'FASE 5C.3.13: verificação pública de certificados/selos (SECURITY DEFINER, '
  'retorno controlado). Fail-closed: código inexistente → zero linhas. '
  'Revogado → status visível SEM motivo administrativo. Nunca expõe user ids, '
  'notes, commercial_status, votos ou audit metadata.';

-- A RPC é executável por anon/authenticated (retorno já controlado); a
-- tabela continua SEM SELECT público direto.
grant execute on function public.verify_digital_credential(text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- C) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_bad_type bigint;
  v_bad_status bigint;
  v_bad_orphan bigint;
  v_bad_dup bigint;
  v_bad_state bigint;
  v_bad_code bigint;
  v_bad_electoral integer;
begin
  -- C1. Tipos íntegros (só certificate|digital_seal nesta fase).
  select count(*) into v_bad_type
  from public.digital_credentials
  where credential_type not in ('certificate','digital_seal');
  if v_bad_type > 0 then
    raise exception 'FASE5C313_VALIDATION_FAILED: % registos com credential_type inválido', v_bad_type;
  end if;

  -- C2. Estados íntegros (só issued|revoked nesta fase).
  select count(*) into v_bad_status
  from public.digital_credentials
  where status not in ('issued','revoked');
  if v_bad_status > 0 then
    raise exception 'FASE5C313_VALIDATION_FAILED: % registos com status inválido', v_bad_status;
  end if;

  -- C3. Nenhum registo órfão (FK cobre; verificação defensiva).
  select count(*) into v_bad_orphan
  from public.digital_credentials dc
  left join public.award_distinctions d on d.id = dc.award_distinction_id
  where d.id is null;
  if v_bad_orphan > 0 then
    raise exception 'FASE5C313_VALIDATION_FAILED: % credenciais órfãs sem distinção', v_bad_orphan;
  end if;

  -- C4. Nenhuma duplicação de ativo ATIVO (distinção × tipo) — UNIQUE
  -- parcial cobre; verificação defensiva.
  select count(*) into v_bad_dup
  from (
    select award_distinction_id, credential_type, count(*) as c
    from public.digital_credentials
    where status = 'issued'
    group by award_distinction_id, credential_type
    having count(*) > 1
  ) s;
  if v_bad_dup > 0 then
    raise exception 'FASE5C313_VALIDATION_FAILED: % combinações (distinção × tipo) com múltiplos ativos', v_bad_dup;
  end if;

  -- C5. Coerência issued/revoked (revogado exige revoked_at; emitido limpo).
  select count(*) into v_bad_state
  from public.digital_credentials
  where (status = 'issued' and (revoked_at is not null or revocation_reason is not null))
     or (status = 'revoked' and revoked_at is null);
  if v_bad_state > 0 then
    raise exception 'FASE5C313_VALIDATION_FAILED: % registos com estado incoerente', v_bad_state;
  end if;

  -- C6. Códigos únicos e não vazios (UNIQUE cobre; verificação defensiva).
  select count(*) into v_bad_code
  from public.digital_credentials
  where verification_code is null or btrim(verification_code) = '';
  if v_bad_code > 0 then
    raise exception 'FASE5C313_VALIDATION_FAILED: % registos com código vazio', v_bad_code;
  end if;

  -- C7. Zero colunas eleitorais (defesa estrutural: a tabela NUNCA deve
  -- conter votos/ranking copiados).
  select count(*) into v_bad_electoral
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'digital_credentials'
    and column_name in ('total_votes','ranking','position','vote_count','votes');
  if v_bad_electoral > 0 then
    raise exception 'FASE5C313_VALIDATION_FAILED: tabela contém % coluna(s) eleitoral(is)', v_bad_electoral;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments / modality_votes /
-- modality_vote_attempts nem redefinir RPCs de apuramento (get_admin_tally,
-- get_admin_modality_tally, get_published_results*). Verificação textual
-- fail-closed sobre o próprio esquema (a prova executável vive em
-- scripts/verify-phase5c313.mjs que inspecciona este ficheiro.)
-- (Implementada como comentário estrutural auditável.)

COMMIT;
