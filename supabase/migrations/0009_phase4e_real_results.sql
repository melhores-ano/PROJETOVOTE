-- ============================================================================
-- Prémios Melhores do Ano Portugal — FASE 4E
-- Migração 0009: resultados reais, apuramento e publicação controlada
-- (NOVA, aditiva e idempotente — NÃO altera as migrations 0001–0008.)
--
-- MOTIVAÇÃO (auditoria Fase 4E):
--  - A função `get_published_results()` (0003) já é segura: SECURITY DEFINER,
--    filtra `campaigns.results_public = true`, expõe SÓ agregados
--    (nenhum ip_hash/device_hash/user_agent_hash/vote_attempts), com GRANT
--    apenas a anon/authenticated. É reutilizada — não é criada paralela.
--  - Problemas corrigidos aqui:
--    1. `row_number()` declarava um vencedor único mesmo em empate
--       (ex.: 15–15 elegia uma empresa pelo UUID). Troca por `rank()`,
--       matematicamente consistente: 1.º, 1.º, 3.º.
--    2. A agregação contava votos sem verificar `campaign_entries.active`,
--       podendo incluir negócios desactivados. Agora só participantes
--       válidos (entry active + city/category/business active).
--    3. Faltavam campos que a UI pública precisa sem novas queries:
--       ids (campaign/city/category/entry/business), `business_verified`
--       (selo) e zeros para participantes sem votos? NÃO — zeros são
--       excluídos de propósito: expor "0 votos" de todos os participantes
--       enquanto results_public=false seria fugas; e com true, só quem tem
--       votos aparece no ranking (participantes sem votos surgem na página
--       da categoria, não no pódio).
--
-- SEGURANÇA:
--  - Nenhuma coluna nova expõe hashes, antifraude, vote_attempts, segredos.
--  - RLS de votes/vote_attempts NÃO é alterada: anon continua SEM SELECT
--    (policies "admin read votes/vote_attempts" apenas). O visitante só lê
--    este agregado, e SÓ quando results_public=true (zero linhas caso
--    contrário — fail-closed).
--  - Para aplicar: executar ESTE ficheiro no SQL Editor do Supabase
--    (ou `supabase db push`). NÃO foi executado automaticamente.
-- ============================================================================

create or replace function public.get_published_results()
returns table (
  campaign_id uuid,
  campaign_year integer,
  campaign_name text,
  city_id uuid,
  city_name text,
  city_slug text,
  category_id uuid,
  category_name text,
  category_slug text,
  campaign_entry_id uuid,
  business_id uuid,
  business_name text,
  business_slug text,
  business_verified boolean,
  total_votes bigint,
  "position" integer
)
language sql
security definer
stable
set search_path = public
as $$
  with tallies as (
    select
      v.campaign_id,
      v.city_id,
      v.category_id,
      v.business_id,
      min(v.campaign_entry_id) as campaign_entry_id,
      count(*)::bigint as total_votes
    from public.votes v
    join public.campaigns c on c.id = v.campaign_id
    where c.results_public = true
    group by v.campaign_id, v.city_id, v.category_id, v.business_id
  ),
  valid as (
    -- Só participantes válidos: inscrição activa + cidade/categoria/
    -- negócio activos. O join também resolve o campaign_entry_id canónico.
    select
      t.campaign_id,
      t.city_id,
      t.category_id,
      t.business_id,
      e.id as campaign_entry_id,
      t.total_votes
    from tallies t
    join public.campaign_entries e
      on e.campaign_id = t.campaign_id
     and e.city_id = t.city_id
     and e.category_id = t.category_id
     and e.business_id = t.business_id
     and e.active = true
  ),
  ranked as (
    -- REGRA DE EMPATE (documentada, sem regra de negócio inventada):
    -- `rank()` devolve 1,1,3 — nenhum vencedor exclusivo é declarado a
    -- partir de ordenação técnica. A ordenação secundária (nome, slug)
    -- serve APENAS para estabilidade visual das linhas empatadas.
    select
      v.*,
      rank() over (
        partition by v.campaign_id, v.city_id, v.category_id
        order by v.total_votes desc
      )::integer as "position"
    from valid v
  )
  select
    c.id,
    c.year,
    c.name,
    ci.id,
    ci.name,
    ci.slug,
    cat.id,
    cat.name,
    cat.slug,
    r.campaign_entry_id,
    b.id,
    b.name,
    b.slug,
    b.verified,
    r.total_votes,
    r."position"
  from ranked r
  join public.campaigns c on c.id = r.campaign_id
  join public.cities ci on ci.id = r.city_id and ci.active = true
  join public.categories cat on cat.id = r.category_id and cat.active = true
  join public.businesses b on b.id = r.business_id and b.active = true
  order by c.year desc, ci.name asc, cat.name asc,
           r."position" asc, b.name asc, b.slug asc;
$$;

-- Permissões: visitantes + autenticados executam; nada mais muda.
revoke all on function public.get_published_results() from public;
grant execute on function public.get_published_results() to anon, authenticated;

comment on function public.get_published_results() is
  'FASE 4E: agregado público de resultados reais (fonte: public.votes). '
  'Devolve linhas APENAS de edições com results_public=true (fail-closed). '
  'Ranking com rank() — empates partilham posição (1,1,3), sem vencedor '
  'exclusivo inventado. Só participantes válidos (campaign_entries active). '
  'Nunca expõe ip_hash/device_hash/user_agent_hash/vote_attempts/segredos.';
