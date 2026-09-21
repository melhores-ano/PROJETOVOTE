-- ============================================================================
-- Prémios Melhores do Ano Portugal — PHASE 3
-- Migração 0006: governação administrativa e preservação histórica
--
-- Princípios:
--  1. Criar uma nova edição anual NUNCA elimina votos históricos.
--     Esta migração bloqueia DELETE de campanhas com votos e DELETE de
--     campaign_entries com votos associados (apenas desactivação/arquivo).
--  2. Auditoria se mantém imutável (trigger audit_no_update já existe;
--     aqui apenas documentado + política de retenção: sem purga automática).
--  3. Índices operacionais para o painel admin (filtros edição×cidade×
--     categoria, ordenação manual e pesquisa).
--  4. Não-destrutiva e idempotente: segura para re-executar.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Protecção histórica: impedir eliminação de campanhas com votos
-- --------------------------------------------------------------------------
create or replace function public.prevent_campaign_delete_with_votes()
returns trigger
language plpgsql
as $$
declare
  vote_count bigint;
begin
  select count(*) into vote_count from public.votes where campaign_id = old.id;
  if vote_count > 0 then
    raise exception 'PHASE3_GUARD: edição % (%) tem % votos históricos e não pode ser eliminada — arquive em vez disso.', old.year, old.name, vote_count
      using errcode = '45000';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_no_campaign_delete_with_votes on public.campaigns;
create trigger trg_no_campaign_delete_with_votes
  before delete on public.campaigns
  for each row execute function public.prevent_campaign_delete_with_votes();

-- --------------------------------------------------------------------------
-- 2. Protecção histórica: impedir remoção de participação com votos
--    (a remoção deve ser desactivação; votos referenciam business_id pelo que
--    o apuramento histórico sobrevive, mas bloqueamos o DELETE físico para
--    evitar quebra de links de auditoria campaign_entry_id).
-- --------------------------------------------------------------------------
create or replace function public.prevent_entry_delete_with_votes()
returns trigger
language plpgsql
as $$
declare
  vote_count bigint;
begin
  select count(*) into vote_count
    from public.votes
    where campaign_entry_id = old.id
       or (campaign_id = old.campaign_id and city_id = old.city_id
           and category_id = old.category_id and business_id = old.business_id);
  if vote_count > 0 then
    raise exception 'PHASE3_GUARD: participação % tem % votos e não pode ser eliminada — desactive em vez disso.', old.id, vote_count
      using errcode = '45000';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_no_entry_delete_with_votes on public.campaign_entries;
create trigger trg_no_entry_delete_with_votes
  before delete on public.campaign_entries
  for each row execute function public.prevent_entry_delete_with_votes();

-- --------------------------------------------------------------------------
-- 3. Índices operacionais do painel Phase 3
-- --------------------------------------------------------------------------
create index if not exists campaign_entries_scope_idx
  on public.campaign_entries (campaign_id, city_id, category_id, position);
create index if not exists campaign_entries_business_idx
  on public.campaign_entries (business_id);
create index if not exists votes_scope_created_idx
  on public.votes (campaign_id, city_id, category_id, created_at desc);
create index if not exists votes_business_scope_idx
  on public.votes (business_id, campaign_id, city_id, category_id);
create index if not exists businesses_slug_idx
  on public.businesses (slug);
create index if not exists businesses_city_idx
  on public.businesses (city_id);
create index if not exists audit_logs_action_created_idx
  on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity, entity_id);

-- --------------------------------------------------------------------------
-- 4. Comentários de governação (documentação viva na BD)
-- --------------------------------------------------------------------------
comment on trigger trg_no_campaign_delete_with_votes on public.campaigns is
  'Phase 3: edições com votos históricos não podem ser eliminadas — usar status arquivada.';
comment on trigger trg_no_entry_delete_with_votes on public.campaign_entries is
  'Phase 3: participações com votos não podem ser eliminadas — usar active=false.';
