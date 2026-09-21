-- ============================================================================
-- Prémios Melhores do Ano Portugal — PHASE 1
-- Migração 0004: correcções da revisão de QA (não-destrutiva, aditiva)
--  1. Policy de INSERT em audit_logs para admins autenticados.
--     SEM esta policy, as escritas de auditoria do painel (audit.ts)
--     falhariam sempre: o RLS bloqueia INSERT sem policy permissiva.
--  2. search_path fixo nas funções SECURITY DEFINER (is_admin,
--     is_super_admin) — endurecimento contra hijacking de search_path
--     (alerta function_search_path_mutable do linter do Supabase).
-- ============================================================================

-- 1. INSERT auditável por admins ------------------------------------------------
drop policy if exists "admin insert audit" on public.audit_logs;
create policy "admin insert audit" on public.audit_logs
  for insert to authenticated
  with check (public.is_admin());

-- 2. search_path fixo nas funções auxiliares ------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  );
$$;
