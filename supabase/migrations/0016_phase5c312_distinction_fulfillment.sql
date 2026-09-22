-- ============================================================================
-- THE BEST EUROPA — FASE 5C.3.12
-- Migração 0016: GESTÃO DE RECONHECIMENTO E ENTREGA DAS DISTINÇÕES
--
-- AUDITORIA (obrigatória antes de programar):
--  - 0014 criou award_modalities + award_distinctions (award_status ×
--    commercial_status separados, UNIQUE edição×cidade×categoria×
--    modalidade×empresa, RLS admin-only, trigger audit_logs genérico).
--  - 0015 criou modality_votes + modality_vote_attempts + RPC
--    get_admin_modality_tally (lê SÓ modality_votes).
--  - Estrutura encontrada: NENHUMA tabela de fulfillment/delivery/
--    reconhecimento existe (verificado por inspecção de 0014/0015 e de
--    src/lib/distinctions.ts). award_distinctions.notes é texto livre
--    comercial — NÃO serve como gestão estruturada de itens/entrega.
--  - Estrutura reutilizada: award_distinctions (FK), audit_logs (auditoria),
--    public.is_admin() (RLS admin-only), public.touch_updated_at().
--  - Necessidade de migration: SIM — nova tabela autónoma, sem alterar
--    nenhuma tabela existente, sem tocar no resultado eleitoral.
--
-- MODELO CONCEITUAL (quatro dimensões SEPARADAS):
--  1. RESULTADO ELEITORAL — votes / modality_votes / rankings (INTOCÁVEL).
--  2. MÉRITO — award_distinctions.award_status (INTOCÁVEL por esta migration).
--  3. RELAÇÃO/ACEITAÇÃO — award_distinctions.commercial_status (INTOCÁVEL).
--  4. RECONHECIMENTO/ENTREGA — distinction_fulfillment (NOVA, esta tabela).
--  Uma alteração no fulfillment NUNCA altera votos, ranking, posição,
--  award_status, commercial_status, vencedor ou resultados públicos.
--
-- ESCOPO (SÓ reconhecimento/entrega, SEM monetização):
--  A) distinction_fulfillment — UM registo POR (distinção × item):
--     certificate | digital_seal | plaque | trophy, com estado próprio
--     pending|preparing|ready|delivered|cancelled + notas administrativas
--     (NUNCA públicas) + suporte de entrega para itens físicos
--     (delivery_method pickup|delivery|event, tracking_reference,
--     delivered_at). UNIQUE (award_distinction_id, item_type) impede
--     duplicação do mesmo item na mesma distinção.
--  - NÃO cria Stripe/checkout/preços/faturação/pagamentos/encomendas.
--  - NÃO copia votos, posição ou ranking (zero colunas eleitorais).
--  - NÃO cria seeds, 2027, países ou programas.
--  - NÃO altera votes / vote_attempts / vote_adjustments / modality_votes /
--    modality_vote_attempts nem redefine RPCs de apuramento.
--  - NÃO executa remotamente — ficheiro local para revisão humana.
--
-- GARANTIAS: transaccional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (IF NOT EXISTS + DROP IF EXISTS antes de CREATE), fail-closed
-- (FK + CHECKs + validações finais abortam o COMMIT), RLS admin-only via
-- public.is_admin(), sem policy para anon. Sem service role no frontend.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) distinction_fulfillment — reconhecimento/entrega por distinção × item
-- --------------------------------------------------------------------------
create table if not exists public.distinction_fulfillment (
  id uuid primary key default gen_random_uuid(),
  award_distinction_id uuid not null
    references public.award_distinctions (id) on delete cascade,
  -- Itens de reconhecimento (fase inicial, controlados):
  --  certificate  = Certificado (controlo administrativo, SEM gerador PDF)
  --  digital_seal = Selo digital (gestão operacional, SEM geração de imagem)
  --  plaque       = Placa (item físico, com suporte de entrega)
  --  trophy       = Troféu (item físico, com suporte de entrega)
  item_type text not null
    check (item_type in ('certificate','digital_seal','plaque','trophy')),
  -- Estados administrativos (fulfillment ≠ mérito ≠ comercial):
  --  pending    = Pendente · preparing = Em preparação · ready = Pronto
  --  delivered  = Entregue · cancelled = Cancelado
  status text not null default 'pending'
    check (status in ('pending','preparing','ready','delivered','cancelled')),
  -- Nota administrativa simples (NUNCA exposta no frontend público).
  notes text,
  -- Suporte administrativo de entrega (apenas relevante para físicos;
  --  NULL para os restantes; pickup = Levantamento, delivery = Entrega,
  --  event = Evento). SEM transportadora/API externa.
  delivery_method text
    check (delivery_method is null or delivery_method in ('pickup','delivery','event')),
  tracking_reference text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.distinction_fulfillment is
  'FASE 5C.3.12: reconhecimento/entrega das distinções — UM registo POR '
  '(distinção × item). Dimensão SEPARADA de votos/ranking (1), mérito '
  'award_status (2) e relação commercial_status (3): alterações aqui NUNCA '
  'alteram o resultado eleitoral, o mérito, a relação comercial, vencedores '
  'ou resultados públicos. Itens: certificate|digital_seal|plaque|trophy. '
  'Estados: pending|preparing|ready|delivered|cancelled. Notas SEMPRE '
  'administrativas (nunca públicas). Entrega: delivery_method|'
  'tracking_reference|delivered_at para itens físicos. SEM pagamentos, SEM '
  'seeds, SEM 2027, SEM novos países/programas.';

comment on column public.distinction_fulfillment.award_distinction_id is
  'FASE 5C.3.12: distinção dona do item (FK → award_distinctions). '
  'ON DELETE CASCADE: remover a distinção remove o seu reconhecimento.';

comment on column public.distinction_fulfillment.item_type is
  'FASE 5C.3.12: tipo de reconhecimento '
  '(certificate|digital_seal|plaque|trophy). UNIQUE por distinção.';

comment on column public.distinction_fulfillment.status is
  'FASE 5C.3.12: estado administrativo do item '
  '(pending|preparing|ready|delivered|cancelled). Independente de '
  'award_status e commercial_status.';

comment on column public.distinction_fulfillment.notes is
  'FASE 5C.3.12: nota administrativa do item (ex.: Placa enviada para '
  'produção). NUNCA exposta no frontend público.';

comment on column public.distinction_fulfillment.delivery_method is
  'FASE 5C.3.12: método de entrega (pickup|delivery|event). NULL quando '
  'não aplicável. SEM integração logística externa.';

-- Um item UMA vez por distinção (Empresa A pode ter Certificado+Selo+Placa;
-- Empresa B Certificado+Troféu; zero/um/vários itens — mas nunca duplicados).
create unique index if not exists distinction_fulfillment_distinction_item_uidx
  on public.distinction_fulfillment (award_distinction_id, item_type);

create index if not exists distinction_fulfillment_distinction_idx
  on public.distinction_fulfillment (award_distinction_id);
create index if not exists distinction_fulfillment_status_idx
  on public.distinction_fulfillment (status);
create index if not exists distinction_fulfillment_item_idx
  on public.distinction_fulfillment (item_type);

drop trigger if exists distinction_fulfillment_touch on public.distinction_fulfillment;
create trigger distinction_fulfillment_touch before update on public.distinction_fulfillment
  for each row execute function public.touch_updated_at();

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
-- Eventos: distinction_fulfillment.created / distinction_fulfillment.updated.
-- Mudanças granulares de estado/notas são registadas pela camada lib
-- (distinction_fulfillment.status_changed / .updated) via audit_logs.
create or replace function public.distinction_fulfillment_audit()
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
      case when TG_OP = 'INSERT' then 'distinction_fulfillment.created' else 'distinction_fulfillment.updated' end,
      'distinction_fulfillment',
      new.id::text,
      jsonb_build_object(
        'award_distinction_id', new.award_distinction_id,
        'item_type', new.item_type,
        'status', new.status
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_distinction_fulfillment_audit on public.distinction_fulfillment;
create trigger trg_distinction_fulfillment_audit
  after insert or update on public.distinction_fulfillment
  for each row execute function public.distinction_fulfillment_audit();

alter table public.distinction_fulfillment enable row level security;

drop policy if exists "public read distinction_fulfillment" on public.distinction_fulfillment;
drop policy if exists "anon read distinction_fulfillment" on public.distinction_fulfillment;
drop policy if exists "authenticated read distinction_fulfillment" on public.distinction_fulfillment;
drop policy if exists "admin manage distinction_fulfillment" on public.distinction_fulfillment;
drop policy if exists "admin read distinction_fulfillment" on public.distinction_fulfillment;

-- FASE 5C.3.12: gestão SOMENTE por admins; sem policy para anon.
-- Com RLS activo e sem policy permissiva, qualquer INSERT/UPDATE/DELETE
-- directo do browser não-admin falha (fail-closed). Programa/campanha são
-- validados na camada de aplicação (distinção pertence à campanha/programa
-- selecionados) + FK garante distinção válida.
create policy "admin manage distinction_fulfillment" on public.distinction_fulfillment
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- B) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_bad_item bigint;
  v_bad_status bigint;
  v_bad_method bigint;
  v_bad_orphan bigint;
  v_bad_dup bigint;
begin
  -- B1. Listas de valores íntegras (defesa contra edição manual inválida).
  select count(*) into v_bad_item
  from public.distinction_fulfillment
  where item_type not in ('certificate','digital_seal','plaque','trophy');
  if v_bad_item > 0 then
    raise exception 'FASE5C312_VALIDATION_FAILED: % registos com item_type inválido', v_bad_item;
  end if;

  select count(*) into v_bad_status
  from public.distinction_fulfillment
  where status not in ('pending','preparing','ready','delivered','cancelled');
  if v_bad_status > 0 then
    raise exception 'FASE5C312_VALIDATION_FAILED: % registos com status inválido', v_bad_status;
  end if;

  select count(*) into v_bad_method
  from public.distinction_fulfillment
  where delivery_method is not null
    and delivery_method not in ('pickup','delivery','event');
  if v_bad_method > 0 then
    raise exception 'FASE5C312_VALIDATION_FAILED: % registos com delivery_method inválido', v_bad_method;
  end if;

  -- B2. Nenhum registo órfão (FK cobre; verificação defensiva).
  select count(*) into v_bad_orphan
  from public.distinction_fulfillment f
  left join public.award_distinctions d on d.id = f.award_distinction_id
  where d.id is null;
  if v_bad_orphan > 0 then
    raise exception 'FASE5C312_VALIDATION_FAILED: % registos órfãos sem distinção', v_bad_orphan;
  end if;

  -- B3. Nenhuma duplicação (distinção × item) — UNIQUE cobre; verificação defensiva.
  select count(*) into v_bad_dup
  from (
    select award_distinction_id, item_type, count(*) as c
    from public.distinction_fulfillment
    group by award_distinction_id, item_type
    having count(*) > 1
  ) s;
  if v_bad_dup > 0 then
    raise exception 'FASE5C312_VALIDATION_FAILED: % combinações (distinção × item) duplicadas', v_bad_dup;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments / modality_votes /
-- modality_vote_attempts nem redefinir RPCs de apuramento (get_admin_tally,
-- get_admin_modality_tally, get_published_results*). Verificação textual
-- fail-closed sobre o próprio esquema (a prova executável vive em
-- scripts/verify-phase5c312.mjs que inspecciona este ficheiro.)
-- (Implementada como comentário estrutural auditável.)

COMMIT;
