-- ============================================================================
-- THE BEST EUROPA — FASE 5C.3.3.2
-- Migração 0013: restaurar no HISTÓRICO LOCAL a RPC
-- public.get_published_results_for_campaign(p_campaign_id uuid)
--
-- Contexto: foi confirmado que esta RPC existe remotamente (produção
-- funcional) mas não existe em nenhuma migration local (0001–0012).
-- Procura por cópia EXATA no histórico local (migrations, docs/, scripts/,
-- src/, artefactos): NENHUMA definição exata encontrada — apenas o chamador
-- frontend (src/hooks/usePublishedResults.ts) que documenta o contrato
-- esperado + fallback para get_published_results(). Sem acesso Git neste
-- ambiente. Logo: NÃO recuperada do histórico; RECONSTRUÍDA COM EVIDÊNCIA.
--
-- Evidência de equivalência:
--  - Mesma assinatura de retorno (16 colunas) de get_published_results()
--    da 0010 (Fase 4F): campaign_id, campaign_year, campaign_name, city_id,
--    city_name, city_slug, category_id, category_name, category_slug,
--    campaign_entry_id, business_id, business_name, business_slug,
--    business_verified, total_votes, position.
--  - Mesma lógica de apuramento 4F: total_final =
--    GREATEST(votos_reais + soma_ajustes, 0), nunca negativo.
--  - Mesmo fail-closed: só edições com campaigns.results_public = true;
--    caso contrário zero linhas. Adicionalmente: p_campaign_id NULL ou
--    campanha inexistente/não publicada → zero linhas.
--  - NÃO expõe votes brutos, IP/hash/device/attempts/anti-fraud, nem votos
--    individuais — só agregados por participante válido.
--  - SECURITY DEFINER + search_path seguro + grants somente anon /
--    authenticated (igual à 0010).
--
-- Escopo: SOMENTE esta RPC. Não altera 0001–0012. Não cria FR/BE.
-- Criar este ficheiro NÃO significa executá-lo remotamente — o banco remoto
-- NÃO deve ser modificado nesta fase (nenhum db push / migration up).
-- ============================================================================

-- CORRECÇÃO 42P13 (mesmo padrão da 0010): a assinatura desta função não
-- existe no histórico local, mas o DROP IF EXISTS protege contra
-- re-execuções e contra colisões caso a definição venha a existir.
drop function if exists public.get_published_results_for_campaign(uuid);

create or replace function public.get_published_results_for_campaign(p_campaign_id uuid)
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
  with real_tallies as (
    -- Votos reais por negócio, SÓ da campanha indicada e SÓ se publicada.
    -- Parâmetro NULL → predicado falso → zero linhas (fail-closed).
    select
      v.campaign_id,
      v.city_id,
      v.category_id,
      v.business_id,
      count(*)::bigint as real_votes
    from public.votes v
    join public.campaigns c on c.id = v.campaign_id
    where c.results_public = true
      and p_campaign_id is not null
      and v.campaign_id = p_campaign_id
    group by v.campaign_id, v.city_id, v.category_id, v.business_id
  ),
  adjustment_tallies as (
    -- Soma dos ajustes administrativos por negócio, SÓ da campanha indicada
    -- e SÓ se publicada. Ajustes de edições não publicadas nunca vazam.
    select
      a.campaign_id,
      a.city_id,
      a.category_id,
      a.business_id,
      coalesce(sum(a.adjustment), 0)::bigint as adjustments_total
    from public.vote_adjustments a
    join public.campaigns c on c.id = a.campaign_id
    where c.results_public = true
      and p_campaign_id is not null
      and a.campaign_id = p_campaign_id
    group by a.campaign_id, a.city_id, a.category_id, a.business_id
  ),
  -- Universo de participantes publicados: quem tem votos reais OU ajustes.
  scope as (
    select campaign_id, city_id, category_id, business_id from real_tallies
    union
    select campaign_id, city_id, category_id, business_id from adjustment_tallies
  ),
  combined as (
    select
      s.campaign_id,
      s.city_id,
      s.category_id,
      s.business_id,
      -- REGRA 4F: total_final = votos reais + ajustes, nunca abaixo de zero.
      greatest(
        coalesce(r.real_votes, 0) + coalesce(a.adjustments_total, 0),
        0
      ) as total_votes
    from scope s
    left join real_tallies r
      on r.campaign_id = s.campaign_id
     and r.city_id = s.city_id
     and r.category_id = s.category_id
     and r.business_id = s.business_id
    left join adjustment_tallies a
      on a.campaign_id = s.campaign_id
     and a.city_id = s.city_id
     and a.category_id = s.category_id
     and a.business_id = s.business_id
  ),
  valid as (
    -- Só participantes válidos: inscrição activa + cidade/categoria/
    -- negócio activos. Totais zerados após o clamp são excluídos (mesma
    -- regra 4E/4F para zeros: não expor "0 votos").
    select
      t.campaign_id,
      t.city_id,
      t.category_id,
      t.business_id,
      e.id as campaign_entry_id,
      t.total_votes
    from combined t
    join public.campaign_entries e
      on e.campaign_id = t.campaign_id
     and e.city_id = t.city_id
     and e.category_id = t.category_id
     and e.business_id = t.business_id
     and e.active = true
    where t.total_votes > 0
  ),
  ranked as (
    -- Empates partilham posição (rank → 1,1,3). Ordenação secundária só
    -- estabilidade visual; nunca declara vencedor exclusivo.
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
  join public.campaigns c
    on c.id = r.campaign_id
   and c.results_public = true
   and c.id = p_campaign_id
  join public.cities ci on ci.id = r.city_id and ci.active = true
  join public.categories cat on cat.id = r.category_id and cat.active = true
  join public.businesses b on b.id = r.business_id and b.active = true
  order by c.year desc, ci.name asc, cat.name asc,
           r."position" asc, b.name asc, b.slug asc;
$$;

-- Permissões públicas (igual à 0010): visitantes + autenticados executam.
-- SECURITY DEFINER mas só lê agregados da campanha publicada indicada;
-- nenhum voto individual, hash, antifraude ou vote_attempts é exposto.
revoke all on function public.get_published_results_for_campaign(uuid) from public;
grant execute on function public.get_published_results_for_campaign(uuid) to anon, authenticated;

comment on function public.get_published_results_for_campaign(uuid) is
  'FASE 5C.3.3.2 (restauração histórico local; existe remotamente): agregado público '
  'POR CAMPANHA = votos reais (public.votes) + ajustes administrativos '
  '(public.vote_adjustments), só do p_campaign_id indicado. total_final = '
  'GREATEST(reais + ajustes, 0) — nunca negativo. Só quando a campanha tem '
  'results_public=true (fail-closed, zero linhas caso contrário, campanha '
  'inexistente ou parâmetro NULL). Ranking com rank() — empates partilham '
  'posição (1,1,3). Só participantes válidos (campaign_entries active) com '
  'total_final > 0. Nunca expõe ip_hash/device_hash/user_agent_hash/'
  'vote_attempts/segredos/votos individuais.';
