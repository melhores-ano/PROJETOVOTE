import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProgramLink, useProgram } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';
import { ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, MapPin, ShieldCheck, Star, Trophy, Vote } from 'lucide-react';
import { useActiveCampaign, useCategories, useCity } from '../../hooks/useDirectory';
import { useEntries } from '../../hooks/useEntries';
import { useCategoryModalities } from '../../hooks/useCategoryModalities';
import { usePublishedResults } from '../../hooks/usePublishedResults';
import { useVotingSettings } from '../../hooks/useVotingSettings';
import { useVoting } from '../../hooks/useVoting';
import { useModalityVoting } from '../../hooks/useModalityVoting';
import { usePageMeta } from '../../components/PageMeta';
import { categoryIcon } from '../../components/icons';
import { VoteModal } from '../../components/VoteModal';
import { ModalityVoteStep } from '../../components/ModalityVoteStep';
import { Badge, EmptyState, ErrorState, LoadingGrid, Eyebrow } from '../../components/ui';
import { demoScopeKey, hasLocalVoteMark } from '../../lib/voting';

/**
 * Phase 2: categoria com motor de votação seguro.
 * - Cada cartão de negócio tem botão "Votar" -> modal de confirmação.
 * - O voto passa SEMPRE pela Edge Function cast-vote (nunca INSERT directo).
 * - Totais exactos NUNCA são exibidos aqui (results_public=false).
 */
export default function CategoryPage() {
  const { citySlug, categorySlug } = useParams<{ citySlug: string; categorySlug: string }>();
  const navigate = useNavigate();
  const { prefix, program, buildPath } = useProgram();
  const { city, loading: cityLoading, error: cityError, refetch } = useCity(citySlug);
  const categoriesQuery = useCategories();
  const category = (categoriesQuery.data ?? []).find((c) => c.slug === categorySlug) ?? null;
  const campaignQuery = useActiveCampaign();
  const entriesQuery = useEntries(campaignQuery.data?.id, city?.id, category?.id);
  const votingSettings = useVotingSettings();
  const voting = useVoting();
  // FASE 5C.3.9 — segunda etapa OPCIONAL (nunca altera o voto principal):
  // modalidades activas da categoria/programa actual + máquina de estados
  // própria do voto de modalidade. Hooks ANTES de qualquer early return.
  const modalitiesQuery = useCategoryModalities(category?.id);
  const modalityVoting = useModalityVoting();
  // Âmbito do "Terminar" da segunda etapa: vale só para a categoria actual
  // (mudar de categoria mostra a etapa dessa categoria, sem arrastar estado).
  const [modalityDismissedScope, setModalityDismissedScope] = useState<string | null>(null);
  const campaign = campaignQuery.data ?? null;
  // FASE 4E: autoridade estrita — só consulta o agregado quando publicado.
  // Se results_public=false, a RPC nem é chamada (nada a inferir no browser).
  // FASE 5C.3.3: contexto explícito da campanha activa do programa actual.
  const published = campaign?.results_public === true;
  const publishedQuery = usePublishedResults(published, campaign?.id ?? null);

  // IMPORTANTE: todos os hooks (incl. usePageMeta -> useEffect interno) têm de
  // correr ANTES de qualquer early return, na mesma ordem em todos os renders.
  // Caso contrário o React lança "Rendered more hooks than during the previous render".
  usePageMeta(
    city && category ? `Melhores ${category.name} de ${city.name} ${campaign?.year ?? 2026} | Prémios Melhores do Ano` : 'Categoria a concurso',
    category?.description
      ? `${category.description} Vote em ${city?.name} — um voto por pessoa nesta categoria.`
      : `Vote na melhor ${category?.name} de ${city?.name} na edição ${campaign?.year ?? 2026}.`,
    {
      canonicalPath: city && category ? buildPath(`/${city.slug}/${category.slug}`) : undefined,
      locale: program?.locale ?? 'pt-PT',
      structuredData: city && category ? {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `Melhores ${category.name} de ${city.name} ${campaign?.year ?? 2026}`,
        description: category.description ?? `Participantes de ${category.name} em ${city.name}.`,
      } : undefined,
    },
  );

  if (cityLoading || categoriesQuery.loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <LoadingGrid count={6} />
      </div>
    );
  }

  if (cityError && !city) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <ErrorState message={cityError} onRetry={refetch} />
      </div>
    );
  }

  if (!city || !category) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Página não encontrada"
          description="A cidade ou categoria que procura não existe ou ainda não está activa."
          action={<ProgramLink to="/cidades" className="mt-2 rounded-lg bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-navy-950">Escolher outra cidade</ProgramLink>}
        />
      </div>
    );
  }

  const Icon = categoryIcon(category.icon);
  const entries = entriesQuery.data ?? [];
  const entriesLoading = entriesQuery.loading || campaignQuery.loading;
  const votingEnabled = votingSettings.data?.votingEnabled ?? true;
  const campaignOpen =
    votingEnabled &&
    !!campaign &&
    (campaign.status === 'activa' || campaign.status === 'votacao');
  const scopeKey = campaign && city && category
    ? demoScopeKey(campaign.id, city.id, category.id)
    : null;
  const categoryVoted = scopeKey ? hasLocalVoteMark(scopeKey) : false;
  // FASE 5C.3.9 — a segunda etapa (destaques) só aparece DEPOIS do voto
  // principal registado com sucesso. O voto principal conclui-se sozinho:
  // nada aqui é exigido para terminar o voto principal.
  const mainVoteRegistered =
    categoryVoted ||
    (voting.phase === 'done' && (voting.status === 'success' || voting.status === 'already_voted'));
  const modalityDismissed = modalityDismissedScope !== null && modalityDismissedScope === scopeKey;
  const showModalityStep = Boolean(
    mainVoteRegistered && !modalityDismissed && campaign && city && category,
  );

  return (
    <div>
      <section className="relative overflow-hidden border-b border-white/[0.07]">
        <div className="absolute inset-0 bg-hero-radial" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16">
          <ProgramLink to={`/cidade/${city.slug}`} className="inline-flex items-center gap-1.5 text-[13px] text-slate-400 transition hover:text-gold-300">
            <ArrowLeft className="h-4 w-4" /> {city.name}
          </ProgramLink>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-gold-500/20 bg-gold-500/[0.08]">
                <Icon className="h-5 w-5 text-gold-400" strokeWidth={2} />
              </span>
              <div>
                <Eyebrow>{city.name} · Edição {campaign?.year ?? 2026}</Eyebrow>
                <h1 className="editorial-h1">{category.name}</h1>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-400">
                  {category.description} Escolha o seu favorito em {city.name} — um voto por pessoa nesta categoria.
                </p>
              </div>
            </div>
            <div className={`flex items-center gap-2 rounded-[12px] border px-4 py-3 ${
              campaignOpen
                ? 'border-gold-500/25 bg-gold-500/[0.07]'
                : 'border-white/10 bg-white/[0.03]'
            }`}>
              {campaignOpen ? (
                <>
                  <Vote className="h-5 w-5 text-gold-400" />
                  <p className="text-xs leading-snug text-gold-200">
                    Votação aberta.<br />Um voto por pessoa nesta categoria.
                  </p>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-5 w-5 text-slate-400" />
                  <p className="text-xs leading-snug text-slate-400">
                    Votação encerrada<br />nesta edição.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16">
        {/* FASE 4E: navegação Cidade → Categoria → classificação (só se publicado). */}
        {published && !publishedQuery.loading && (publishedQuery.data ?? []).some(
          (r) => r.city_slug === city.slug && r.category_slug === category.slug,
        ) && (
          <ProgramLink
            to={`/${city.slug}/${category.slug}/resultados`}
            className="mb-6 flex items-center gap-4 rounded-[14px] border border-gold-500/25 bg-gold-500/[0.06] p-5 transition hover:border-gold-500/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-gold-500/20 bg-gold-500/[0.08]">
              <Trophy className="h-5 w-5 text-gold-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-300/90">
                Resultados oficiais publicados
              </span>
              <span className="mt-0.5 block truncate text-sm text-slate-400">
                Ver o pódio auditado de {category.name} em {city.name} — 1.º, 2.º e 3.º lugar.
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-gold-300/80" />
          </ProgramLink>
        )}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[13px] text-slate-500">
          <span className="inline-flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-gold-400/80" />
            {entries.length} {entries.length === 1 ? 'participante' : 'participantes'} em {city.name} · Edição {campaign?.year ?? 2026}
          </span>
          {categoryVoted && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-1 text-xs font-medium text-emerald-300">
              <BadgeCheck className="h-3.5 w-3.5" /> Já votou nesta categoria
            </span>
          )}
        </div>

        {entriesLoading ? (
          <LoadingGrid count={6} />
        ) : entries.length === 0 ? (
          <EmptyState
            title="Participantes a serem anunciados"
            description={`Os negócios de ${category.name} em ${city.name} serão revelados em breve. Volte para descobrir os nomeados.`}
          />
        ) : (
          <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => {
              const b = entry.business;
              return (
                <article
                  key={entry.id}
                  className="card-lift group flex flex-col overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.025] hover:border-gold-500/25"
                >
                  <ProgramLink
                    to={`/empresa/${b.slug}`}
                    className="flex h-24 items-center justify-center bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950"
                    aria-label={`Ver perfil de ${b.name}`}
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-white/10 bg-navy-950/60 font-display text-xl font-bold text-gold-400/90">
                      {b.name.charAt(0)}
                    </span>
                  </ProgramLink>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-display text-[1.05rem] font-bold text-white">{b.name}</h3>
                      {b.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-gold-400/90" aria-label="Negócio verificado" />}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-400">
                      {b.description ?? 'Negócio local participante.'}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <Badge tone={entry.featured ? 'gold' : 'navy'}>
                        {entry.featured ? (
                          <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" /> Destaque</span>
                        ) : (
                          b.verified ? 'Verificado' : 'Participante'
                        )}
                      </Badge>
                      <ProgramLink
                        to={`/empresa/${b.slug}`}
                        className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-400 transition hover:text-gold-300"
                      >
                        Ver perfil <ArrowRight className="h-3.5 w-3.5" />
                      </ProgramLink>
                    </div>
                    <button
                      type="button"
                      disabled={!campaignOpen || voting.phase === 'submitting' || voting.phase === 'confirming'}
                      onClick={() => campaign && voting.openConfirm({
                        entryId: entry.id,
                        businessName: b.name,
                        categoryName: category.name,
                        cityName: city.name,
                        campaignId: campaign.id,
                        cityId: city.id,
                        categoryId: category.id,
                      })}
                      title={campaignOpen ? `Votar em ${b.name}` : 'Votação encerrada'}
                      className="btn-gold-refined mt-4 w-full disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Vote className="h-4 w-4" />
                      {campaignOpen ? 'Votar' : 'Votação encerrada'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* FASE 5C.3.9 — segunda etapa OPCIONAL: só depois do voto principal
            registado com sucesso. "Voto registado!" confirma a etapa principal;
            "Agora escolha os destaques desta categoria" (ModalityVoteStep)
            oferece 1 voto POR modalidade activa — votar numa, em várias,
            ignorar todas ou terminar. Empresas listadas: só participantes
            elegíveis da campanha × cidade × categoria actuais (entries). */}
        {showModalityStep && (
          <div
            role="status"
            aria-live="polite"
            className="mx-auto mt-10 flex max-w-7xl items-start gap-3 rounded-[14px] border border-emerald-500/25 bg-emerald-500/[0.07] px-5 py-4 sm:px-6"
          >
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="font-display text-lg font-bold text-white">Voto registado!</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-slate-300">
                Obrigado por participar. Se desejar, continue para a segunda etapa opcional abaixo —
                ou termine por aqui: o seu voto principal já está guardado.
              </p>
            </div>
          </div>
        )}

        {showModalityStep && (
          <ModalityVoteStep
            modalities={modalitiesQuery.data ?? []}
            entries={entries}
            campaignId={campaign!.id}
            cityId={city.id}
            cityName={city.name}
            categoryId={category.id}
            categoryName={category.name}
            campaignOpen={campaignOpen}
            modalitiesLoading={modalitiesQuery.loading}
            phase={modalityVoting.phase}
            target={modalityVoting.target}
            status={modalityVoting.status}
            message={modalityVoting.message}
            captchaToken={modalityVoting.captchaToken}
            onCaptchaToken={modalityVoting.setCaptchaToken}
            turnstileEnabled={votingSettings.data?.turnstileEnabled ?? false}
            turnstileSiteKey={votingSettings.data?.turnstileSiteKey ?? ''}
            onPick={modalityVoting.openConfirm}
            onConfirm={modalityVoting.submit}
            onCancel={modalityVoting.cancel}
            onClose={modalityVoting.reset}
            onDone={() => {
              modalityVoting.reset();
              if (scopeKey) setModalityDismissedScope(scopeKey);
            }}
          />
        )}

        <p className="mx-auto mt-10 max-w-2xl rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-5 text-center text-[13px] leading-relaxed text-slate-500">
          Um voto por pessoa, por categoria, por cidade e por edição. A votação é anónima e
          protegida contra duplicados — sem contas, sem dados pessoais.
        </p>
      </section>

      <VoteModal
        phase={voting.phase}
        target={voting.target}
        status={voting.status}
        message={voting.message}
        captchaToken={voting.captchaToken}
        onCaptchaToken={voting.setCaptchaToken}
        turnstileEnabled={votingSettings.data?.turnstileEnabled ?? false}
        turnstileSiteKey={votingSettings.data?.turnstileSiteKey ?? ''}
        onConfirm={voting.submit}
        onCancel={voting.cancel}
        onClose={voting.reset}
        onVoteElsewhere={() => {
          voting.reset();
          navigate(programPaths.city(prefix, city.slug));
        }}
      />
    </div>
  );
}
