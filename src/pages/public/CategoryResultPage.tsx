import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ProgramLink, useProgram } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';
import {
  ArrowLeft,
  Award,
  Lock,
  Medal,
  MapPin,
  BadgeCheck,
  Scale,
  AlertTriangle,
} from 'lucide-react';
import { useActiveCampaign, useCategories, useCity } from '../../hooks/useDirectory';
import { usePublishedResults } from '../../hooks/usePublishedResults';
import { usePageMeta } from '../../components/PageMeta';
import { Eyebrow, EmptyState, PageLoading } from '../../components/ui';
import { filterGroup, formatVotesPt, formatPositionPt } from '../../lib/results';

const PLACE_LABEL = ['1.º Lugar', '2.º Lugar', '3.º Lugar'] as const;

function placeTone(i: number): string {
  if (i === 0)
    return 'border-gold-500/25 bg-gold-500/[0.06]';
  if (i === 1) return 'border-white/[0.08] bg-white/[0.025]';
  return 'border-white/[0.08] bg-white/[0.02]';
}

/**
 * FASE 4E — Pódio público por cidade × categoria a partir de votos REAIS.
 * Rotas: /:citySlug/:categorySlug/resultados (e /:year/:citySlug/:categorySlug/resultados).
 * - Autoridade: `campaigns.results_public === true`. Se false, nem a RPC é
 *   chamada — nenhum total/ranking chega ao browser.
 * - Empates: rank() local (1.º, 1.º, 3.º). Certificado de "1.º Lugar" único
 *   SÓ quando há um só primeiro; em empate mostra pódio partilhado sem
 *   declarar vencedor exclusivo.
 * - Hooks todos antes de early returns (ordem estável, sem regressão do
 *   erro "Rendered more hooks than during the previous render").
 */
export default function CategoryResultPage() {
  const { prefix, program, buildPath } = useProgram();
  const params = useParams<{ citySlug?: string; categorySlug?: string; year?: string }>();
  // Suporta prefixo de ano opcional: o router monta os mesmos params em ordens distintas.
  const citySlug = params.citySlug ?? params.year;
  const categorySlug = params.categorySlug;
  const { city, loading: cityLoading } = useCity(citySlug);
  const categoriesQuery = useCategories();
  const category = (categoriesQuery.data ?? []).find((c) => c.slug === categorySlug) ?? null;
  const campaignQuery = useActiveCampaign();

  const campaign = campaignQuery.data ?? null;
  const published = campaign?.results_public === true;
  // FASE 5C.3.3: pódio resolvido pela campanha activa do programa actual.
  const resultsQuery = usePublishedResults(published, campaign?.id ?? null);

  const rows = useMemo(
    () => filterGroup(resultsQuery.data ?? [], citySlug, categorySlug).slice(0, 10),
    [resultsQuery.data, citySlug, categorySlug],
  );
  const podium = useMemo(() => rows.filter((r) => r.position <= 3), [rows]);
  const firstPlace = useMemo(() => rows.filter((r) => r.position === 1), [rows]);
  const soleWinner = firstPlace.length === 1;

  const year = campaign?.year ?? 2026;
  const title =
    city && category
      ? `Melhor ${category.name} de ${city.name} ${year} | Prémios Melhores do Ano`
      : 'Resultados oficiais';
  const description =
    city && category
      ? `Vencedores de ${category.name} em ${city.name} na edição ${year}: 1.º, 2.º e 3.º lugar eleitos pelo público.`
      : 'Os vencedores auditados dos Melhores do Ano Portugal.';

  usePageMeta(title, description, {
    canonicalPath: city && category ? buildPath(`/${city.slug}/${category.slug}/resultados`) : buildPath('/resultados'),
    locale: program?.locale ?? 'pt-PT',
    structuredData:
      city && category && soleWinner && podium.length > 0
        ? {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: title,
            itemListElement: podium.map((r, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: `${PLACE_LABEL[Math.min(i, 2)]} — ${r.business_name}`,
              url: programPaths.business(prefix, r.business_slug),
            })),
          }
        : undefined,
  });

  if (cityLoading || categoriesQuery.loading || campaignQuery.loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <PageLoading label="A carregar os vencedores…" />
      </div>
    );
  }

  if (!city || !category) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Página não encontrada"
          description="A cidade ou categoria que procura não existe ou ainda não está activa."
          action={
            <ProgramLink
              to="/resultados"
              className="mt-2 rounded-lg bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-navy-950"
            >
              Ver todos os resultados
            </ProgramLink>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <section className="relative overflow-hidden border-b border-white/[0.07]">
        <div className="absolute inset-0 bg-hero-radial" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-16">
          <ProgramLink
            to={`/${city.slug}/${category.slug}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-slate-400 transition hover:text-gold-300"
          >
            <ArrowLeft className="h-4 w-4" /> {category.name} em {city.name}
          </ProgramLink>
          <Eyebrow>
            {city.name} · Edição {year} · Resultados oficiais
          </Eyebrow>
          <h1 className="editorial-h1 mt-2">
            {category.name} <span className="text-gold-300/90">em {city.name}</span>
          </h1>
          <p className="mt-3 flex max-w-2xl items-center gap-1.5 text-[15px] text-slate-400">
            <MapPin className="h-4 w-4 shrink-0 text-gold-400/80" /> {description}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-16">
        {!published ? (
          <div className="mx-auto max-w-xl rounded-[16px] border border-white/[0.08] bg-white/[0.025] p-10 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[12px] border border-gold-500/20 bg-gold-500/[0.08]">
              <Lock className="h-5 w-5 text-gold-400" />
            </span>
            <h2 className="editorial-h3 mt-5">
              Resultados ainda não publicados
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
              Os resultados desta edição serão divulgados após o encerramento e
              validação da votação. Os vencedores de {category.name} em {city.name}{' '}
              serão publicados aqui — até lá, nenhum total ou posição é revelado.
            </p>
            <ProgramLink
              to={`/${city.slug}/${category.slug}`}
              className="btn-gold-refined mt-6"
            >
              Ver participantes
            </ProgramLink>
          </div>
        ) : resultsQuery.loading ? (
          <PageLoading label="A apurar os vencedores…" />
        ) : resultsQuery.error ? (
          <div className="mx-auto max-w-xl rounded-[16px] border border-red-500/25 bg-red-500/[0.04] p-10 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-red-400" aria-hidden />
            <h2 className="editorial-h3 mt-4">
              Falha ao carregar os vencedores
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
              {resultsQuery.error}. Tente novamente.
            </p>
            <button
              type="button"
              onClick={resultsQuery.refetch}
              className="btn-gold-refined mt-6"
            >
              Tentar novamente
            </button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Apuramento em curso"
            description={`A publicação foi activada, mas os vencedores de ${category.name} em ${city.name} ainda estão em apuramento.`}
          />
        ) : soleWinner ? (
          <div>
            {/* Certificado do vencedor único (só sem empate no 1.º) */}
            <article className="relative overflow-hidden rounded-[16px] border border-gold-500/25 bg-white/[0.025] p-8 text-center sm:p-10">
              <div
                className="pointer-events-none absolute inset-3 rounded-[12px] border border-gold-500/15"
                aria-hidden
              />
              <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                Prémios Melhores do Ano Portugal · {year}
              </p>
              <span className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full border border-gold-500/25 bg-gold-500/[0.1]">
                <Award className="h-8 w-8 text-gold-400" strokeWidth={2} />
              </span>
              <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.2em] text-gold-300/90">
                1.º Lugar
              </p>
              <h2 className="mx-auto mt-2 flex max-w-xl items-center justify-center gap-2 font-display text-3xl font-bold text-white sm:text-4xl">
                {firstPlace[0].business_name}
                {firstPlace[0].business_verified && (
                  <BadgeCheck className="h-8 w-8 shrink-0 text-gold-400" aria-label="Negócio verificado" />
                )}
              </h2>
              <p className="mt-3 text-sm text-slate-300">
                Melhor {category.name} de {city.name} {year} —{' '}
                {formatVotesPt(firstPlace[0].total_votes)} do público
              </p>
              <ProgramLink
                to={`/empresa/${firstPlace[0].business_slug}`}
                className="btn-gold-refined mt-6"
              >
                <BadgeCheck className="h-4 w-4" /> Ver perfil do vencedor
              </ProgramLink>
            </article>

            {podium.length > 1 && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {podium.slice(1).map((r) => (
                  <article
                    key={r.business_slug}
                    className={`rounded-[14px] border p-6 text-center ${placeTone(r.position - 1)}`}
                  >
                    <Medal
                      className={`mx-auto h-7 w-7 ${r.position === 2 ? 'text-slate-300' : 'text-amber-600/80'}`}
                    />
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {formatPositionPt(r.position)} Lugar
                    </p>
                    <h3 className="mt-1.5 flex items-center justify-center gap-1.5 font-display text-[1.35rem] font-bold text-white">
                      {r.business_name}
                      {r.business_verified && (
                        <BadgeCheck className="h-[18px] w-[18px] shrink-0 text-gold-400/90" aria-label="Negócio verificado" />
                      )}
                    </h3>
                    <p className="mt-2 text-[13px] text-slate-400">
                      {formatVotesPt(r.total_votes)}
                    </p>
                    <ProgramLink
                      to={`/empresa/${r.business_slug}`}
                      className="mt-4 inline-flex text-[13px] font-semibold text-gold-300 hover:underline"
                    >
                      Ver perfil
                    </ProgramLink>
                  </article>
                ))}
              </div>
            )}

            {rows.length > podium.length && (
              <ol className="mt-5 divide-y divide-white/5 overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.02]">
                {rows.slice(podium.length).map((r) => (
                  <li key={r.business_slug}>
                    <ProgramLink
                      to={`/empresa/${r.business_slug}`}
                      className="flex items-center gap-3 px-6 py-3.5 transition hover:bg-white/[0.04]"
                    >
                      <span className="w-8 shrink-0 text-center text-sm font-bold text-slate-500">
                        {formatPositionPt(r.position)}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-white">
                          {r.business_name}
                        </span>
                        {r.business_verified && (
                          <BadgeCheck className="h-4 w-4 shrink-0 text-gold-400" aria-label="Negócio verificado" />
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-gold-300">
                        {formatVotesPt(r.total_votes)}
                      </span>
                    </ProgramLink>
                  </li>
                ))}
              </ol>
            )}

            <p className="mx-auto mt-8 max-w-2xl rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-5 text-center text-[13px] leading-relaxed text-slate-500">
              Apuramento auditado a partir de votos reais e anónimos — um voto por
              pessoa, por categoria, por cidade e por edição.
            </p>
          </div>
        ) : (
          <div>
            {/* Empate no 1.º lugar: pódio partilhado, SEM vencedor exclusivo */}
            <article className="relative overflow-hidden rounded-[16px] border border-gold-500/25 bg-white/[0.025] p-8 text-center sm:p-10">
              <div
                className="pointer-events-none absolute inset-3 rounded-[12px] border border-gold-500/15"
                aria-hidden
              />
              <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                Prémios Melhores do Ano Portugal · {year}
              </p>
              <span className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full border border-gold-500/25 bg-gold-500/[0.1]">
                <Scale className="h-8 w-8 text-gold-400" strokeWidth={2} />
              </span>
              <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.2em] text-gold-300/90">
                Empate no 1.º lugar
              </p>
              <h2 className="editorial-h2 mx-auto mt-2 max-w-2xl">
                {firstPlace.map((r) => r.business_name).join(' · ')}
              </h2>
              <p className="mt-3 text-sm text-slate-400">
                {firstPlace.length} empatados com {formatVotesPt(firstPlace[0].total_votes)}{' '}
                cada — a posição é partilhada e nenhum vencedor exclusivo é declarado
                por ordenação técnica.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                {firstPlace.map((r) => (
                  <ProgramLink
                    key={r.business_slug}
                    to={`/empresa/${r.business_slug}`}
                    className="btn-gold-refined !min-h-[42px] !px-5 !text-[13.5px]"
                  >
                    <BadgeCheck className="h-4 w-4" /> {r.business_name}
                  </ProgramLink>
                ))}
              </div>
            </article>

            {rows.length > firstPlace.length && (
              <ol className="mt-5 divide-y divide-white/5 overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.02]">
                {rows.slice(firstPlace.length).map((r) => (
                  <li key={r.business_slug}>
                    <ProgramLink
                      to={`/empresa/${r.business_slug}`}
                      className="flex items-center gap-3 px-6 py-3.5 transition hover:bg-white/[0.04]"
                    >
                      <Medal
                        className={`h-5 w-5 shrink-0 ${
                          r.position === 2
                            ? 'text-slate-200'
                            : r.position === 3
                              ? 'text-amber-600'
                              : 'text-slate-600'
                        }`}
                        aria-label={`${formatPositionPt(r.position)} lugar`}
                      />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-white">
                          {formatPositionPt(r.position)} {r.business_name}
                        </span>
                        {r.business_verified && (
                          <BadgeCheck className="h-4 w-4 shrink-0 text-gold-400" aria-label="Negócio verificado" />
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-gold-300">
                        {formatVotesPt(r.total_votes)}
                      </span>
                    </ProgramLink>
                  </li>
                ))}
              </ol>
            )}

            <p className="mx-auto mt-8 max-w-2xl rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-5 text-center text-[13px] leading-relaxed text-slate-500">
              Empate tratado com posição partilhada ({firstPlace.map(() => '1.º').join(', ')},{' '}
              {rows.length > firstPlace.length
                ? `${formatPositionPt(rows[firstPlace.length].position)} a seguir`
                : 'sem classificados seguintes ainda'})
              — sem regra de desempate inventada. Apuramento auditado a partir de
              votos reais e anónimos.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
