-- ============================================================================
-- Prémios Melhores do Ano Portugal — PHASE 1
-- Migração 0002: hardening (não-destrutiva)
--  1. audit_logs verdadeiramente imutável (bloqueia UPDATE/DELETE ao nível
--     da BD, inclusive para service_role).
--  2. Trigger updated_at em falta para site_settings.
-- ============================================================================

-- 1. Imutabilidade de audit_logs ----------------------------------------------
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs é imutável: UPDATE/DELETE bloqueados (tabela de auditoria).';
  return null;
end;
$$;

drop trigger if exists audit_no_update on public.audit_logs;
create trigger audit_no_update
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();

-- 2. updated_at automático em site_settings ------------------------------------
drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch before update on public.site_settings
  for each row execute function public.touch_updated_at();
