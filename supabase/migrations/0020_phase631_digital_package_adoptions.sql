-- ============================================================================
-- THE BEST EUROPA — FASE 6.3.1 (PILOTO BRAGA 2026)
-- Migração 0020: PACOTE OFICIAL DIGITAL — ADESÃO COMERCIAL VOLUNTÁRIA
--
-- DIAGNÓSTICO (auditoria antes de escrever):
--  - 0014 criou award_modalities + award_distinctions (award_status ×
--    commercial_status separados, UNIQUE edição×cidade×categoria×
--    modalidade×empresa, RLS admin-only, trigger audit_logs genérico).
--  - 0015 criou modality_votes + modality_vote_attempts + RPC
--    get_admin_modality_tally (lê SÓ modality_votes).
--  - 0016 criou distinction_fulfillment (UM registo POR distinção×item:
--    certificate|digital_seal|plaque|trophy, UNIQUE
--    (award_distinction_id, item_type), RLS admin-only, sem SELECT anon).
--  - 0017 criou digital_credentials + RPC pública
--    verify_digital_credential (única superfície pública de verificação).
--  - 0018 criou participant_invitations (funil PRÉ-VOTAÇÃO, sem tocar no
--    resultado eleitoral). 0019 criou category_areas + categories.area_id
--    (navegação, NÃO eleitoral).
--  - Estrutura encontrada: NENHUMA tabela de adesão comercial / pacote /
--    package / subscription existe (pesquisado em 0001–0019 e em src/lib +
--    src/pages/admin). award_distinctions.commercial_status é CRM simples
--    (pending|contacted|accepted|declined|confirmed|cancelled) — NÃO serve
--    como registo estruturado de pacote (sem package_code, preço, moeda,
--    consentimento Meta Ads, includes_*).
--  - Estrutura reutilizada: award_distinctions (FK), audit_logs (auditoria),
--    public.is_admin() (RLS admin-only), public.touch_updated_at().
--  - Necessidade de migration: SIM — nova tabela autónoma
--    distinction_package_adoptions, sem alterar nenhuma tabela existente,
--    sem tocar no resultado eleitoral.
--
-- MODELO CONCEITUAL (três camadas INDEPENDENTES):
--  1. RESULTADO ELEITORAL — votes / modality_votes / rankings (INTOCÁVEL).
--  2. DISTINÇÃO/MÉRITO — award_distinctions.award_status (INTOCÁVEL por esta
--     migration; NENHUM trigger altera award_status automaticamente).
--  3. ADESÃO COMERCIAL VOLUNTÁRIA — distinction_package_adoptions (NOVA,
--     esta tabela): UM registo POR distinção (UNIQUE award_distinction_id).
--     A distinção já determina campanha/cidade/categoria/empresa — NÃO se
--     duplicam city_id/campaign_id/business_id aqui.
--
-- PILOTO (valores operacionais, NÃO presos por CHECK):
--  package_code = TBE-DIGITAL-2026
--  package_name = Pacote Oficial Digital The Best Europa 2026
--  package_type = digital
--  price_cents  = 4990 (49,90 €, preço em cêntimos, moeda EUR)
--  A arquitetura permite futuros TBE-DIGITAL-2027 / TBE-PREMIUM-2027 /
--  TBE-PHYSICAL-2027 SEM migration destrutiva (package_code é texto livre,
--  package_type aceita digital|physical|hybrid).
--
-- ESCOPO (SÓ registo administrativo da adesão, SEM pagamento):
--  A) distinction_package_adoptions — UM registo POR distinção:
--     package_code, package_type digital|physical|hybrid, package_name,
--     price_cents >= 0, currency DEFAULT 'EUR', status
--     pending|active|cancelled DEFAULT 'active', adopted_at, cancelled_at,
--     cancel_reason, includes_certificate|digital_seal|digital_kit|
--     publication|meta_ads (DEFAULT true), meta_ads_consent_at,
--     notes (interna), created_at/updated_at. UNIQUE award_distinction_id.
--  B) RLS admin-only via public.is_admin(). SEM policy para anon. Nenhuma
--     informação comercial torna-se pública automaticamente.
--  C) Auditoria best-effort em audit_logs (trigger, nunca bloqueia):
--     package_adoption.created/.cancelled/.reactivated/.updated.
--  - NÃO cria Stripe/MB WAY/Multibanco/checkout/gateway/payment_intent/
--    invoice/pagamento. NÃO usa paid/unpaid/payment_pending.
--  - NÃO copia votos, posição ou ranking (zero colunas eleitorais).
--  - NÃO altera distinction_fulfillment, digital_credentials, RPC
--    verify_digital_credential, award_status, commercial_status.
--  - NÃO cria seeds, 2027, países ou programas.
--  - NÃO altera votes / vote_attempts / vote_adjustments / modality_votes /
--    modality_vote_attempts / campaign_entries nem redefine RPCs.
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
-- A) distinction_package_adoptions — adesão voluntária ao Pacote Oficial
-- --------------------------------------------------------------------------
create table if not exists public.distinction_package_adoptions (
  id uuid primary key default gen_random_uuid(),
  award_distinction_id uuid not null
    references public.award_distinctions (id) on delete cascade,
  -- Código operacional do pacote (texto livre para evolução futura:
  -- TBE-DIGITAL-2026 no piloto; futuros TBE-DIGITAL-2027, TBE-PREMIUM-2027,
  -- TBE-PHYSICAL-2027 SEM migration destrutiva). INTENCIONALMENTE sem CHECK
  -- prendendo o sistema a Braga ou a um único código.
  package_code text not null,
  -- Tipo de pacote (evolutivo): digital|physical|hybrid. O piloto usa
  -- 'digital'. physical/hybrid reservados para futuros pacotes Premium.
  package_type text not null
    check (package_type in ('digital','physical','hybrid')),
  package_name text not null,
  -- Preço em cêntimos (ex.: 4990 = 49,90 €). SEM gateway nesta fase.
  price_cents integer not null
    check (price_cents >= 0),
  currency text not null default 'EUR',
  -- Estado administrativo da adesão (SEM paid/unpaid/payment_pending):
  --  pending   = Pendente · active = Ativo · cancelled = Cancelado
  status text not null default 'active'
    check (status in ('pending','active','cancelled')),
  adopted_at timestamptz,
  cancelled_at timestamptz,
  -- Motivo administrativo do cancelamento (interno, nunca público).
  cancel_reason text,
  -- Benefícios incluídos no pacote piloto (todos true por omissão).
  includes_certificate boolean not null default true,
  includes_digital_seal boolean not null default true,
  includes_digital_kit boolean not null default true,
  includes_publication boolean not null default true,
  includes_meta_ads boolean not null default true,
  -- Consentimento explícito para a campanha patrocinada CONJUNTA (15 dias,
  -- coletiva, sem garantia individual). Preenchido pela aplicação (now())
  -- quando o admin marca a checkbox obrigatória no modal.
  meta_ads_consent_at timestamptz,
  -- Notas INTERNAS (nunca expostas publicamente).
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Coerência de estados: cancelado exige cancelled_at; ativo/pendente
  -- nunca tem cancelled_at.
  check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status in ('pending','active') and cancelled_at is null)
  )
);

comment on table public.distinction_package_adoptions is
  'FASE 6.3.1 (piloto Braga 2026): adesão VOLUNTÁRIA ao Pacote Oficial '
  'Digital The Best Europa 2026 (TBE-DIGITAL-2026, 4990 cents, EUR, 100% '
  'digital). UM registo POR distinção (UNIQUE award_distinction_id). Camada '
  'SEPARADA de (1) resultado eleitoral, (2) mérito award_status e (3) relação '
  'commercial_status: registar/cancelar a adesão NUNCA altera votos, ranking, '
  'posição, award_status, vencedor ou resultados públicos. SEM pagamento '
  '(sem Stripe/MB WAY/checkout). Consentimento Meta Ads (campanha coletiva '
  'de 15 dias, sem garantias individuais) em meta_ads_consent_at. Notas '
  'SEMPRE administrativas (nunca públicas).';

comment on column public.distinction_package_adoptions.award_distinction_id is
  'FASE 6.3.1: distinção dona da adesão (FK → award_distinctions). '
  'ON DELETE CASCADE: remover a distinção remove a sua adesão. A distinção '
  'já determina campanha/cidade/categoria/empresa — sem duplicação.';

comment on column public.distinction_package_adoptions.package_code is
  'FASE 6.3.1: código operacional do pacote (ex.: TBE-DIGITAL-2026 no '
  'piloto). Texto livre para evolução futura sem migration destrutiva.';

comment on column public.distinction_package_adoptions.price_cents is
  'FASE 6.3.1: preço em cêntimos (4990 = 49,90 € no piloto). Registo '
  'administrativo — SEM gateway, SEM checkout, SEM faturação automática.';

comment on column public.distinction_package_adoptions.meta_ads_consent_at is
  'FASE 6.3.1: consentimento explícito para a campanha patrocinada CONJUNTA '
  'de 15 dias (coletiva, sem garantia individual de impressões/alcance/ '
  'cliques/leads/vendas). Preenchido com now() ao marcar a checkbox '
  'obrigatória.';

-- UMA adesão POR distinção (a distinção já determina edição×cidade×
-- categoria×empresa; impedir duplo registo do mesmo pacote).
create unique index if not exists distinction_package_adoptions_distinction_uidx
  on public.distinction_package_adoptions (award_distinction_id);

create index if not exists distinction_package_adoptions_distinction_idx
  on public.distinction_package_adoptions (award_distinction_id);
create index if not exists distinction_package_adoptions_status_idx
  on public.distinction_package_adoptions (status);
create index if not exists distinction_package_adoptions_code_idx
  on public.distinction_package_adoptions (package_code);
create index if not exists distinction_package_adoptions_type_idx
  on public.distinction_package_adoptions (package_type);

drop trigger if exists distinction_package_adoptions_touch on public.distinction_package_adoptions;
create trigger distinction_package_adoptions_touch before update on public.distinction_package_adoptions
  for each row execute function public.touch_updated_at();

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
-- Eventos: package_adoption.created / package_adoption.cancelled /
-- package_adoption.reactivated / package_adoption.updated. Detalhe granular
-- (package_code, status, preço) via lib (best-effort, nunca bloqueia).
create or replace function public.distinction_package_adoptions_audit()
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
      v_action := 'package_adoption.created';
    elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
      case new.status
        when 'cancelled' then v_action := 'package_adoption.cancelled';
        when 'active' then
          if old.status = 'cancelled' then
            v_action := 'package_adoption.reactivated';
          else
            v_action := 'package_adoption.updated';
          end if;
        else v_action := 'package_adoption.updated';
      end case;
    else
      v_action := 'package_adoption.updated';
    end if;
    insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
    values (
      auth.uid(),
      v_action,
      'distinction_package_adoptions',
      new.id::text,
      jsonb_build_object(
        'award_distinction_id', new.award_distinction_id,
        'package_code', new.package_code,
        'package_type', new.package_type,
        'status', new.status
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_distinction_package_adoptions_audit on public.distinction_package_adoptions;
create trigger trg_distinction_package_adoptions_audit
  after insert or update on public.distinction_package_adoptions
  for each row execute function public.distinction_package_adoptions_audit();

alter table public.distinction_package_adoptions enable row level security;

drop policy if exists "public read distinction_package_adoptions" on public.distinction_package_adoptions;
drop policy if exists "anon read distinction_package_adoptions" on public.distinction_package_adoptions;
drop policy if exists "authenticated read distinction_package_adoptions" on public.distinction_package_adoptions;
drop policy if exists "admin manage distinction_package_adoptions" on public.distinction_package_adoptions;
drop policy if exists "admin read distinction_package_adoptions" on public.distinction_package_adoptions;

-- FASE 6.3.1: gestão SOMENTE por admins; sem policy para anon.
-- Com RLS activo e sem policy permissiva, qualquer INSERT/UPDATE/DELETE
-- directo do browser não-admin falha (fail-closed). Nenhuma informação
-- comercial torna-se pública automaticamente (sem SELECT público).
-- Programa/campanha validados na camada de aplicação (distinção pertence à
-- campanha/programa selecionados) + FK garante distinção válida.
create policy "admin manage distinction_package_adoptions" on public.distinction_package_adoptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- B) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_bad_type bigint;
  v_bad_status bigint;
  v_bad_price bigint;
  v_bad_orphan bigint;
  v_bad_dup bigint;
  v_bad_state bigint;
  v_bad_electoral integer;
begin
  -- B1. Tipos íntegros (digital|physical|hybrid — evolutivo, sem Braga em CHECK).
  select count(*) into v_bad_type
  from public.distinction_package_adoptions
  where package_type not in ('digital','physical','hybrid');
  if v_bad_type > 0 then
    raise exception 'FASE631_VALIDATION_FAILED: % registos com package_type inválido', v_bad_type;
  end if;

  -- B2. Estados íntegros (pending|active|cancelled — SEM paid/unpaid).
  select count(*) into v_bad_status
  from public.distinction_package_adoptions
  where status not in ('pending','active','cancelled');
  if v_bad_status > 0 then
    raise exception 'FASE631_VALIDATION_FAILED: % registos com status inválido', v_bad_status;
  end if;

  -- B3. Preço em cêntimos não-negativo.
  select count(*) into v_bad_price
  from public.distinction_package_adoptions
  where price_cents is null or price_cents < 0;
  if v_bad_price > 0 then
    raise exception 'FASE631_VALIDATION_FAILED: % registos com price_cents inválido', v_bad_price;
  end if;

  -- B4. Nenhum registo órfão (FK cobre; verificação defensiva).
  select count(*) into v_bad_orphan
  from public.distinction_package_adoptions p
  left join public.award_distinctions d on d.id = p.award_distinction_id
  where d.id is null;
  if v_bad_orphan > 0 then
    raise exception 'FASE631_VALIDATION_FAILED: % adesões órfãs sem distinção', v_bad_orphan;
  end if;

  -- B5. Nenhuma duplicação por distinção — UNIQUE cobre; verificação defensiva.
  select count(*) into v_bad_dup
  from (
    select award_distinction_id, count(*) as c
    from public.distinction_package_adoptions
    group by award_distinction_id
    having count(*) > 1
  ) s;
  if v_bad_dup > 0 then
    raise exception 'FASE631_VALIDATION_FAILED: % distinções com múltiplas adesões', v_bad_dup;
  end if;

  -- B6. Coerência cancelado × cancelled_at.
  select count(*) into v_bad_state
  from public.distinction_package_adoptions
  where (status = 'cancelled' and cancelled_at is null)
     or (status in ('pending','active') and cancelled_at is not null);
  if v_bad_state > 0 then
    raise exception 'FASE631_VALIDATION_FAILED: % registos com estado incoerente', v_bad_state;
  end if;

  -- B7. Zero colunas eleitorais (defesa estrutural: a tabela NUNCA deve
  -- conter votos/ranking copiados nem duplicar campanha/cidade/empresa).
  select count(*) into v_bad_electoral
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'distinction_package_adoptions'
    and column_name in ('total_votes','ranking','position','vote_count','votes','city_id','campaign_id','business_id','category_id');
  if v_bad_electoral > 0 then
    raise exception 'FASE631_VALIDATION_FAILED: tabela contém % coluna(s) proibida(s)', v_bad_electoral;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments / modality_votes /
-- modality_vote_attempts / campaign_entries nem redefinir RPCs de apuramento
-- (get_admin_tally, get_admin_modality_tally, get_published_results*) ou de
-- verificação (verify_digital_credential), nem ALTER/DROP em tabelas
-- anteriores. Verificação textual fail-closed sobre o próprio esquema
-- (a prova executável vive em scripts/verify-phase631.mjs que inspecciona
-- este ficheiro.)
-- (Implementada como comentário estrutural auditável.)

COMMIT;
