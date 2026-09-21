-- ============================================================================
-- Prémios Melhores do Ano Portugal — BACKEND REAL
-- Migração 0007: lockdown seguro de site_settings (aditiva, idempotente)
-- NÃO altera as migrations 0001–0006. Aplica-se DEPOIS delas.
--
-- Problema (auditoria): a policy "public read settings" (0001) permite a
-- anon/authenticated ler TODAS as chaves de site_settings. Se um segredo
-- fosse colocado ali por engano, ficaria público.
--
-- Correção:
--  1. Coluna `is_public` (default false): só chaves explicitamente públicas
--     são legíveis por visitantes.
--  2. Nova policy restrita substitui a leitura totalmente aberta.
--  3. Backfill explícito: apenas chaves de apresentação/operacionais
--     não-sensíveis ficam públicas. NUNCA segredos.
--  4. REGRA DE OURO (documentada): VOTE_HASH_SECRET, TURNSTILE_SECRET_KEY e
--     service_role vivem APENAS como Edge Secrets — nunca em site_settings.
-- ============================================================================

alter table public.site_settings
  add column if not exists is_public boolean not null default false;

-- Backfill: chaves seguras para exposição pública (UI + Edge Function).
-- Operacionais de votação precisam de ser legíveis pela Edge via
-- service_role de qualquer forma; torná-las públicas permite também ao
-- frontend ler flags sem bypass. Segredos NÃO estão nesta lista.
update public.site_settings set is_public = true where key in (
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
);

-- Substituir a leitura totalmente aberta por leitura só-pública.
drop policy if exists "public read settings" on public.site_settings;
drop policy if exists "public read public settings" on public.site_settings;
create policy "public read public settings" on public.site_settings
  for select to anon, authenticated using (is_public = true);

-- Gestão total continua só-admin (já existia na 0001; reafirmada idempotente).
drop policy if exists "admin manage settings" on public.site_settings;
create policy "admin manage settings" on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

comment on column public.site_settings.is_public is
  '0007: apenas chaves com is_public=true são legíveis por anon. Nunca colocar segredos (VOTE_HASH_SECRET, TURNSTILE_SECRET_KEY, service_role) nesta tabela.';
