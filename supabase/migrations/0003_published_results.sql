-- ============================================================================
-- Prémios Melhores do Ano Portugal — PHASE 1
-- Migração 0003: publicação de resultados (SÓ LEITURA, sem voto)
-- Função SECURITY DEFINER que expõe tallies agregados APENAS de edições
-- com `campaigns.results_public = true`. Enquanto nenhuma edição estiver
-- publicada, a função devolve zero linhas (nada é exposto).
-- Nenhum dado individual de voto é exposto — só contagens por negócio.
-- ============================================================================

create or replace function public.get_published_results()
returns table (
  campaign_year integer,
  campaign_name text,
  city_name text,
  city_slug text,
  category_name text,
  category_slug text,
  business_name text,
  business_slug text,
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
      count(*)::bigint as total_votes
    from public.votes v
    join public.campaigns c on c.id = v.campaign_id
    where c.results_public = true
    group by v.campaign_id, v.city_id, v.category_id, v.business_id
  ),
  ranked as (
    select
      t.*,
      row_number() over (
        partition by t.campaign_id, t.city_id, t.category_id
        order by t.total_votes desc, t.business_id
      )::integer as "position"
    from tallies t
  )
  select
    c.year,
    c.name,
    ci.name,
    ci.slug,
    cat.name,
    cat.slug,
    b.name,
    b.slug,
    r.total_votes,
    r."position"
  from ranked r
  join public.campaigns c on c.id = r.campaign_id
  join public.cities ci on ci.id = r.city_id and ci.active = true
  join public.categories cat on cat.id = r.category_id and cat.active = true
  join public.businesses b on b.id = r.business_id and b.active = true
  order by c.year desc, ci.name asc, cat.name asc, r."position" asc;
$$;

-- Por defeito as funções são executáveis por public: revogar e conceder
-- apenas aos papéis que o sítio utiliza (anon = visitantes, authenticated).
revoke all on function public.get_published_results() from public;
grant execute on function public.get_published_results() to anon, authenticated;
