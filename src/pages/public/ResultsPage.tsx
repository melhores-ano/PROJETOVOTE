import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Trophy,
  Lock,
  ArrowRight,
  Medal,
  MapPin,
  Hourglass,
  Radio,
  BadgeCheck,
  Scale,
  AlertTriangle,
} from 'lucide-react';
import { useActiveCampaign, useSiteConfig } from '../../hooks/useDirectory';
import { useProgram, ProgramLink } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';
import { usePageMeta } from '../../components/PageMeta';
import { usePublishedResults } from '../../hooks/usePublishedResults';
import { useLiveResults } from '../../hooks/useLiveResults';
import {
  groupRealResults,
  formatVotesPt,
  formatPositionPt,
  type RankedGroup,
} from '../../lib/results';
import { PageLoading, SectionHeading, EmptyState } from '../../components/ui';

const medalTone = ['text-gold-400', 'text-slate-300', 'text-amber-600'];

/**
 * FASE 4E — Resultados oficiais a partir de votos REAIS (public.votes).
 * - Autoridade de publicação: `campaigns.results_public` (estrito).
 *   Enquanto false: ZERO contagens/ranking/percentagens chegam ao browser
 *   (a RPC devolve vazio e nem é chamada) — só mensagem de não-publicado.
 * - Ranking com rank() recalculado localmente: empates partilham posição
 *   (1.º, 1.º, 3.º); selo "Vencedor" só com 1.º lugar isolado.
 * - Todos os hooks correm antes de qualquer early return (ordem estável).
 */
export default function ResultsPage() {
  const campaignQuery = useActiveCampaign();
  const configQuery = useSiteConfig();
  // FASE 5C.3.4: programa actual da rota (origem única); suporta
  // /pt/resultados/:categorySlug filtrando por categoria.
  const { prefix, program } = useProgram();
  const { categorySlug } = useParams<{ categorySlug?: string }>();

  const campaign = campaignQuery.data ?? null;
  // PASSO 5/10: autoridade ESTRITA = campaigns.results_public.
  // `results_visible` (site_settings) é legado/operacional e NÃO publica
  // sozinho — fail-closed por omissão.
  const published = campaign?.results_public === true;

  // FASE 5C.3.3: resultados resolvidos pela campanha activa do programa
  // actual (contexto explícito); realtime ignora outro programa.
  const resultsQuery = usePublishedResults(published, campaign?.id ?? null);
  const { live } = useLiveResults({
    enabled: published,
    onSignal: resultsQuery.refetch,
    awardProgramId: program?.id ?? null,
  });
  // FASE 5C.3.4: /pt/resultados/:categorySlug filtra os grupos da categoria.
  const groups: RankedGroup[] = useMemo(() => {
    const all = groupRealResults(resultsQuery.data ?? []);
    if (!categorySlug) return all;
    return all.filter((g) => g.category_slug === categorySlug);
  }, [resultsQuery.data, categorySlug]);

  usePageMeta(
    categorySlug ? 'Resultados oficiais por categoria' : 'Resultados oficiais',
    undefined,
    {
      canonicalPath: categorySlug
        ? programPaths.resultsByCategory(prefix, categorySlug)
        : programPaths.results(prefix),
      locale: program?.locale ?? 'pt-PT',
    },
  );

  const configLoading = campaignQuery.loading || configQuery.loading;

  if (configLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <PageLoading label="A carregar os resultados…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-16">
      <SectionHeading
        eyebrow="Transparência total"
        title={
          <>
            Resultados oficiais
          </>
        }
        description={
          campaign
            ? `${campaign.name} · os vencedores auditados de cada cidade e categoria.`
            : undefined
        }
      />

      {published && !resultsQuery.loading && groups.length > 0 && (
        <p className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${
              live
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border-white/10 bg-white/[0.03] text-slate-400'
            }`}
          >
            <Radio className="h-3.5 w-3.5" aria-hidden />
            {live ? 'Actualização em directo' : 'Actualização periódica'}
          </span>
        </p>
      )}

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
            validação da votação. Enquanto isso, nenhum total, ranking ou
            vencedor é divulgado — nem nesta página nem na API pública.
          </p>
          <ProgramLink
            to="/cidades"
            className="btn-gold-refined mt-6"
          >
            Explorar participantes <ArrowRight className="h-4 w-4" />
          </ProgramLink>
        </div>
      ) : resultsQuery.loading ? (
        <PageLoading label="A apurar os resultados publicados…" />
      ) : resultsQuery.error ? (
        <div className="mx-auto max-w-xl rounded-[16px] border border-red-500/25 bg-red-500/[0.04] p-10 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-red-400" aria-hidden />
          <h2 className="editorial-h3 mt-4">
            Falha ao carregar os resultados
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
            {resultsQuery.error}. Tente novamente — os dados oficiais continuam
            preservados e auditados.
          </p>
          <button
            type="button"
            onClick={resultsQuery.refetch}
            className="btn-gold-refined mt-6"
          >
            Tentar novamente
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="mx-auto max-w-xl text-center">
          <EmptyState
            title="Resultados em apuramento"
            description="A publicação foi activada, mas o apuramento ainda está em curso. Os vencedores surgirão aqui por cidade e categoria."
          />
          <Hourglass className="mx-auto mt-4 h-5 w-5 text-gold-500" aria-hidden />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {groups.map((g) => (
            <article
              key={g.key}
              className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.025]"
            >
              <header className="border-b border-white/[0.07] bg-navy-900/50 px-6 py-4">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  <MapPin className="h-3.5 w-3.5 text-gold-400/70" />
                  {g.city_name} · {g.campaign_year}
                </p>
                <h2 className="mt-1 font-display text-[1.15rem] font-bold text-white">
                  {g.category_name}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {g.rows.length} {g.rows.length === 1 ? 'classificado' : 'classificados'} ·{' '}
                  {formatVotesPt(g.total_votes)} no total
                </p>
              </header>
              <ol className="divide-y divide-white/5">
                {g.rows.slice(0, 5).map((r) => (
                  <li key={r.business_slug}>
                    <ProgramLink
                      to={`/empresa/${r.business_slug}`}
                      className="flex items-center gap-3 px-6 py-3.5 transition hover:bg-white/[0.04]"
                    >
                      {r.position <= 3 ? (
                        <Medal
                          className={`h-5 w-5 shrink-0 ${medalTone[r.position - 1]}`}
                          aria-label={`${formatPositionPt(r.position)} lugar`}
                        />
                      ) : (
                        <span className="w-5 shrink-0 text-center text-sm font-bold text-slate-600">
                          {formatPositionPt(r.position)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="block truncate text-sm font-semibold text-white">
                            {formatPositionPt(r.position)} {r.business_name}
                          </span>
                          {r.business_verified && (
                            <BadgeCheck
                              className="h-4 w-4 shrink-0 text-gold-400"
                              aria-label="Negócio verificado"
                            />
                          )}
                        </span>
                        {r.position === 1 && g.soleWinner && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-gold-300">
                            <Trophy className="h-3 w-3" /> Vencedor
                          </span>
                        )}
                        {r.position === 1 && !g.soleWinner && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                            <Scale className="h-3 w-3" /> Empate no 1.º lugar
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-gold-300">
                        {formatVotesPt(r.total_votes)}
                      </span>
                    </ProgramLink>
                  </li>
                ))}
              </ol>
              <footer className="border-t border-white/10 px-6 py-3">
                <ProgramLink
                  to={`/${g.city_slug}/${g.category_slug}/resultados`}
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-gold-300 hover:underline"
                >
                  <Trophy className="h-3.5 w-3.5" /> Ver pódio — 1.º, 2.º e 3.º lugar
                </ProgramLink>
                <span className="mx-2 text-slate-600">·</span>
                <ProgramLink
                  to={`/${g.city_slug}/${g.category_slug}`}
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-300 hover:underline"
                >
                  Ver todos os participantes <ArrowRight className="h-3.5 w-3.5" />
                </ProgramLink>
              </footer>
            </article>
          ))}
        </div>
      )}

      {published && groups.length > 0 && (
        <p className="mx-auto mt-8 max-w-2xl rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-5 text-center text-[13px] leading-relaxed text-slate-500">
          Apuramento auditado a partir de votos reais e anónimos — um voto por
          pessoa, por categoria, por cidade e por edição. Em caso de empate, os
          participantes partilham a posição (1.º, 1.º, 3.º) e nenhum vencedor
          exclusivo é declarado por ordenação técnica.
        </p>
      )}
    </div>
  );
}
