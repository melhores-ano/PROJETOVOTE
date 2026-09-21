-- ============================================================================
-- Premios Melhores do Ano Portugal — BACKEND REAL
-- Migracao 0008: publicacao Realtime para resultados ao vivo (aditiva, idempotente)
-- NAO altera as migrations 0001-0007. Aplica-se DEPOIS delas.
--
-- Raciocinio de seguranca:
--  - `votes`, `vote_attempts` e `audit_logs` NUNCA entram na publicacao:
--    anon nao tem leitura nessas tabelas (RLS) e os votos individuais nunca
--    sao expostos. O placar publico e sempre agregado via RPC
--    `get_published_results` (ver 0003).
--  - Publicamos apenas os sinais que o visitante ja pode ler:
--      campaigns      (flip de results_public / status -> hero "ao vivo")
--      site_settings  (chaves is_public=true: results_visible, voting_enabled)
--  - O frontend assina estes sinais via supabase.channel() e faz refetch do
--    agregado. Sem polling agressivo; polling de 30s e so fallback quando o
--    websocket nao conecta (preview / redes restritas).
-- ============================================================================

-- A publicacao supabase_realtime existe em qualquer projeto Supabase
-- (criada pela plataforma). Os blocos DO tornam tudo re-executavel.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- campaigns: sinal de abertura/encerramento/publicacao de resultados.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns'
    ) then
      alter publication supabase_realtime add table public.campaigns;
    end if;

    -- site_settings: flags publicas (results_visible, voting_enabled, ...).
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_settings'
    ) then
      alter publication supabase_realtime add table public.site_settings;
    end if;

    -- sponsors: tira de patrocinadores pode atualizar em direto no rodape.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sponsors'
    ) then
      alter publication supabase_realtime add table public.sponsors;
    end if;
  end if;
end
$$;

-- Replica identity FULL para que o payload do Realtime traga a linha completa
-- (o frontend filtra por is_public / results_public; sem isto so chega a PK).
-- Idempotente: repetir ALTER e inofensivo.
alter table public.campaigns replica identity full;
alter table public.site_settings replica identity full;
alter table public.sponsors replica identity full;

-- Guardas anti-regressao: se alguem tentar publicar tabelas sensiveis no futuro,
-- este comentario documenta a proibicao (aplicado por revisao, nao por trigger,
-- para nao bloquear o owner em operacoes legitimas de manutencao).
comment on publication supabase_realtime is
  '0008: sinais publicos ao vivo = campaigns, site_settings, sponsors. PROIBIDO adicionar votes, vote_attempts, audit_logs, profiles (dados sensiveis / RLS).';

-- ============================================================================
-- 0008-B: is_public a prova de ordem de aplicacao (seed / re-seed / upserts)
-- A 0007 faz backfill uma unica vez. Se o seed (ou qualquer insert) correr
-- DEPOIS da 0007 em base fresca, as linhas nasceriam com is_public=false e o
-- sitio publico ficaria cego (flags de votacao invisiveis para anon).
-- Este trigger BEFORE garante que as chaves conhecidamente publicas nascem e
-- permanecem publicas, independentemente da ordem seed/migrations/upserts.
-- Chaves fora da lista mantem o default false (seguro por omissao).
-- ============================================================================

create or replace function public.site_settings_force_public()
returns trigger
language plpgsql
as $$
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
$$;

drop trigger if exists site_settings_force_public on public.site_settings;
create trigger site_settings_force_public
  before insert or update of key, value, is_public on public.site_settings
  for each row execute function public.site_settings_force_public();

-- Re-backfill defensivo: corrige linhas que ja tenham nascido com
-- is_public=false (ex.: seed aplicado apos a 0007 em base fresca).
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
) and is_public = false;
