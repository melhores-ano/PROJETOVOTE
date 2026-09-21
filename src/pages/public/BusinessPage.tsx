import { useNavigate, useParams } from 'react-router-dom';
import { ProgramLink, useProgram } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';
import {
  ArrowLeft, BadgeCheck, MapPin, Phone, Mail, Globe, Instagram, Facebook,
  Map as MapIcon, ShieldCheck, Trophy, Star, Vote,
} from 'lucide-react';
import { useBusiness, useActiveCampaign } from '../../hooks/useDirectory';
import { useActiveEntriesForBusiness, useBusinessEntries } from '../../hooks/useEntries';
import { usePublishedResults } from '../../hooks/usePublishedResults';
import { useVotingSettings } from '../../hooks/useVotingSettings';
import { useVoting } from '../../hooks/useVoting';
import { usePageMeta } from '../../components/PageMeta';
import { VoteModal } from '../../components/VoteModal';
import { Badge, EmptyState, PageLoading, ErrorState } from '../../components/ui';
import { hasLocalVoteMark, demoScopeKey } from '../../lib/voting';

/**
 * FASE 4D — Perfil público do negócio com voto real.
 * - Inscrições activas na campanha activa via `campaign_entries`
 *   (qualquer cidade/categoria — sem hardcodes).
 * - Cada inscrição expõe o `campaign_entry_id` real usado no `cast-vote`.
 * - Voto passa SEMPRE pela Edge Function; nunca INSERT directo.
 */
export default function BusinessPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const navigate = useNavigate();
  const { prefix, program, buildPath } = useProgram();
  const { data: business, loading, error, refetch } = useBusiness(businessSlug);
  const participationsQuery = useBusinessEntries(business?.id);
  const campaignQuery = useActiveCampaign();
  const campaign = campaignQuery.data;
  const activeEntriesQuery = useActiveEntriesForBusiness(business?.id, campaign?.id);
  const votingSettings = useVotingSettings();
  const voting = useVoting();
  const editionYear = campaign?.year ?? 2026;
  // FASE 4E: classificação real do negócio quando publicada (agregado seguro).
  // Gate estrito: se results_public=false, a RPC nem é chamada.
  // FASE 5C.3.3: contexto explícito da campanha activa do programa actual.
  const published = campaign?.results_public === true;
  const publishedQuery = usePublishedResults(published, campaign?.id ?? null);

  usePageMeta(
    business ? `${business.name} · Melhores do Ano` : 'Empresa participante',
    business?.description ?? undefined,
    {
      canonicalPath: business ? programPaths.business(prefix, business.slug) : undefined,
      locale: program?.locale ?? 'pt-PT',
    },
  );

  if (loading) return <div className="mx-auto max-w-5xl px-4 sm:px-6"><PageLoading label="A carregar o perfil…" /></div>;
  if (error && !business) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }
  if (!business) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Negócio não encontrado"
          description="O perfil que procura não existe ou foi desactivado."
          action={<ProgramLink to="/cidades" className="mt-2 rounded-lg bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-navy-950">Explorar cidades</ProgramLink>}
        />
      </div>
    );
  }

  const contacts = [
    business.phone && { icon: Phone, label: business.phone, href: `tel:${business.phone.replace(/\s/g, '')}` },
    business.email && { icon: Mail, label: business.email, href: `mailto:${business.email}` },
    business.website && { icon: Globe, label: 'Sítio oficial', href: business.website },
    business.instagram && { icon: Instagram, label: 'Instagram', href: business.instagram },
    business.facebook && { icon: Facebook, label: 'Facebook', href: business.facebook },
    business.google_maps_url && { icon: MapIcon, label: 'Ver no mapa', href: business.google_maps_url },
  ].filter(Boolean) as { icon: typeof Globe; label: string; href: string }[];

  const votingEnabled = votingSettings.data?.votingEnabled ?? true;
  const campaignOpen =
    votingEnabled &&
    !!campaign &&
    (campaign.status === 'activa' || campaign.status === 'votacao');
  const activeEntries = activeEntriesQuery.data ?? [];
  const entriesLoading = activeEntriesQuery.loading || campaignQuery.loading;
  const submitting = voting.phase === 'submitting';

  return (
    <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-16">
      <ProgramLink to="/cidades" className="inline-flex items-center gap-1.5 text-[13px] text-slate-400 transition hover:text-gold-300">
        <ArrowLeft className="h-4 w-4" /> Voltar às cidades
      </ProgramLink>

      <article className="mt-6 overflow-hidden rounded-[16px] border border-white/[0.08] bg-white/[0.025]">
        {/* Capa */}
        <div className="relative flex h-44 items-end overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950 p-6 sm:h-52">
          {business.cover_url ? (
            <>
              <img src={business.cover_url} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/70 to-navy-950/30" aria-hidden />
            </>
          ) : (
            <div className="absolute inset-0 bg-hero-radial" aria-hidden />
          )}
          <div className="relative flex items-center gap-4">
            {business.logo_url ? (
              <img
                src={business.logo_url}
                alt={`Logótipo de ${business.name}`}
                className="h-16 w-16 rounded-[12px] border border-white/10 bg-navy-950 object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-[12px] border border-white/10 bg-navy-950/70 font-display text-3xl font-bold text-gold-400/90">
                {business.name.charAt(0)}
              </span>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="editorial-h1 !text-[clamp(1.75rem,3vw+1rem,2.4rem)]">{business.name}</h1>
                {business.verified && <BadgeCheck className="h-5 w-5 shrink-0 text-gold-400/90" aria-label="Negócio verificado" />}
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-400">
                <MapPin className="h-3.5 w-3.5 text-gold-400/80" />
                {business.city?.name ?? 'Portugal'}
                {business.address && <span className="text-slate-500"> · {business.address}</span>}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={business.verified ? 'gold' : 'navy'}>
                {business.verified ? 'Negócio verificado' : `Participante ${editionYear}`}
              </Badge>
              {(business.categories ?? []).map((c) => (
                <Badge key={c.id} tone="navy">{c.name}</Badge>
              ))}
            </div>
            <h2 className="mt-6 font-display text-[1.25rem] font-bold text-white">Sobre</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-400">
              {business.description ?? `Perfil do negócio participante nos Melhores do Ano ${editionYear}.`}
            </p>

            {/* FASE 4E: classificação oficial (só quando results_public=true). */}
            {published && !publishedQuery.loading && (() => {
              const standings = (publishedQuery.data ?? [])
                .filter((r) => r.business_slug === business.slug)
                .sort((a, b) => a.campaign_year - b.campaign_year);
              if (standings.length === 0) return null;
              return (
                <div className="mt-6 overflow-hidden rounded-[14px] border border-gold-500/25 bg-gold-500/[0.04]">
                  <p className="flex items-center gap-2 border-b border-gold-500/15 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300/90">
                    <Trophy className="h-3.5 w-3.5" /> Classificação oficial
                  </p>
                  <ul className="divide-y divide-white/5">
                    {standings.map((s) => {
                      const tiedFirst =
                        s.position === 1 &&
                        (publishedQuery.data ?? []).filter(
                          (r) => r.city_slug === s.city_slug && r.category_slug === s.category_slug && r.campaign_year === s.campaign_year && r.position === 1,
                        ).length > 1;
                      return (
                        <li key={`${s.campaign_year}-${s.city_slug}-${s.category_slug}`} className="flex items-center gap-3 px-5 py-3.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-gold-500/20 bg-gold-500/[0.08] font-display text-base font-bold text-gold-300">
                            {s.position}º
                          </span>
                          <span className="min-w-0 flex-1">
                            <ProgramLink
                              to={`/${s.city_slug}/${s.category_slug}/resultados`}
                              className="block truncate text-sm font-semibold text-white hover:text-gold-200 hover:underline"
                            >
                              {s.position}.º lugar · {s.category_name} em {s.city_name} {s.campaign_year}
                            </ProgramLink>
                            <span className="mt-0.5 block text-xs text-slate-400">
                              {s.total_votes} {s.total_votes === 1 ? 'voto' : 'votos'} do público
                              {tiedFirst && ' · empate no 1.º lugar (posição partilhada)'}
                              {s.position === 1 && !tiedFirst && ' · vencedor'}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}

            {/* Participações em edições */}
            {!participationsQuery.loading && (participationsQuery.data ?? []).length > 0 && (
              <div className="mt-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Trophy className="h-4 w-4 text-gold-400" />
                  Participações no prémio
                </h3>
                <ul className="mt-3 space-y-2">
                  {(participationsQuery.data ?? []).map((p, i) => (
                    <li key={`${p.campaign_year}-${p.city_slug}-${p.category_slug}-${i}`}>
                      <ProgramLink
                        to={`/${p.city_slug}/${p.category_slug}`}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-navy-950/50 px-4 py-2.5 text-sm transition hover:border-gold-500/50"
                      >
                        <span className="font-display font-bold text-gold-300">{p.campaign_year}</span>
                        <span className="truncate text-slate-300">
                          {p.city_name} · {p.category_name}
                        </span>
                        {p.featured && (
                          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-semibold text-gold-300">
                            <Star className="h-3 w-3" /> Destaque
                          </span>
                        )}
                      </ProgramLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Voto real — inscrições activas na campanha activa */}
            <div className="mt-8 rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-5">
              <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                <Vote className="h-4 w-4 text-gold-400/90" /> Apoie este negócio
              </p>
              {entriesLoading ? (
                <p className="mt-3 text-sm text-gold-100/70">A verificar participações activas…</p>
              ) : activeEntries.length === 0 ? (
                <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-gold-100">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />
                  Este negócio não tem inscrições activas na edição {editionYear}.
                  Explore as categorias da sua cidade para votar.
                </p>
              ) : !campaignOpen ? (
                <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-gold-100">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />
                  A votação desta campanha está encerrada. Obrigado por apoiar o comércio local.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {activeEntries.map((entry) => {
                    const scope = demoScopeKey(entry.campaignId, entry.cityId, entry.categoryId);
                    const voted = hasLocalVoteMark(scope);
                    return (
                      <li
                        key={entry.entryId}
                        className="flex flex-col gap-3 rounded-xl border border-white/10 bg-navy-950/60 p-4 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">
                            {entry.cityName} · {entry.categoryName}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            Um voto por pessoa nesta categoria. Voto anónimo e auditado.
                            {voted && <span className="ml-1 font-semibold text-emerald-300">· Já votou aqui</span>}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => campaign && voting.openConfirm({
                            entryId: entry.entryId,
                            businessName: business.name,
                            categoryName: entry.categoryName,
                            cityName: entry.cityName,
                            campaignId: entry.campaignId,
                            cityId: entry.cityId,
                            categoryId: entry.categoryId,
                          })}
                          className="btn-gold-refined !min-h-[42px] !px-5 !text-[13.5px]"
                        >
                          <Vote className="h-4 w-4" />
                          {submitting ? 'A registar voto…' : 'Votar'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <aside className="h-fit rounded-[14px] border border-white/[0.08] bg-navy-950/60 p-5">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Contactos</p>
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-500">Contactos a serem actualizados.</p>
            ) : (
              <ul className="space-y-2.5">
                {contacts.map((c) => (
                  <li key={c.label + c.href}>
                    <a
                      href={c.href}
                      target={c.href.startsWith('http') ? '_blank' : undefined}
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-slate-200 transition hover:border-gold-500/50 hover:text-gold-200"
                    >
                      <c.icon className="h-4 w-4 shrink-0 text-gold-400" />
                      <span className="truncate">{c.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {business.address && (
              <p className="mt-4 text-xs leading-relaxed text-slate-500">{business.address}</p>
            )}
          </aside>
        </div>
      </article>

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
          const t = voting.target;
          voting.reset();
          if (t) {
            const entry = activeEntries.find((e) => e.entryId === t.entryId);
            if (entry) navigate(buildPath(`/${entry.citySlug}/${entry.categorySlug}`));
          }
        }}
      />
    </div>
  );
}
