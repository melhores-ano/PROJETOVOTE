import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Award, MapPin, Search, Trophy, ShieldCheck, Users, ChevronRight,
  BadgeCheck, Vote, ArrowRight, Star, Landmark,
} from 'lucide-react';
import { useActiveCampaign, useCategories, useCities, useCitySearch, useSiteConfig } from '../../hooks/useDirectory';
import { categoryIcon } from '../../components/icons';
import { Badge, EmptyState, GoldDivider, LoadingGrid, SectionHeading } from '../../components/ui';
import { SponsorsStrip } from '../../components/SponsorsStrip';
import { HeroSlider } from '../../components/HeroSlider';
import { formatDatePt } from '../../lib/utils';
import { ProgramLink, useProgram } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';

export default function HomePage() {
  const navigate = useNavigate();
  const { prefix } = useProgram();
  const [term, setTerm] = useState('');
  const citiesQuery = useCities();
  const categoriesQuery = useCategories();
  const campaignQuery = useActiveCampaign();
  const configQuery = useSiteConfig();

  const cities = citiesQuery?.data ?? [];
  const results = useCitySearch(cities ?? [], term ?? '');
  const showSuggestions = (term ?? '').trim().length > 0;

  const featured = useMemo(() => (cities ?? []).slice(0, 8), [cities]);
  const tagline = configQuery?.data?.branding?.tagline ?? 'A sua cidade. A sua escolha. O seu voto.';
  const editionYear = campaignQuery?.data?.year ?? 2026;

  return (
    <div>
      {/* ============ HERO SLIDER PREMIUM (FASE 5B.2) ============ */}
      <HeroSlider editionYear={editionYear} />

      {/* ============ PESQUISA + MÃ‰TRICAS (sobrepostas Ã  base do hero) â€” 5B.4 minimalista ============ */}
      <div className="relative z-30 mx-auto max-w-7xl px-5 sm:px-6">
        <div className="-mt-28 sm:-mt-32">
          {/* Card de pesquisa â€” parte da landing, nÃ£o dashboard */}
          <div className="overflow-visible rounded-[16px] border border-white/[0.08] bg-navy-900/70 p-5 backdrop-blur-xl sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500/[0.12] sm:flex">
                  <Search className="h-4 w-4 text-gold-400" strokeWidth={2.25} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    The Best Europa Â· EdiÃ§Ã£o {editionYear}
                  </p>
                  <p className="mt-1 truncate font-display text-[17px] font-bold text-white">
                    Encontre a sua cidade
                  </p>
                  <p className="mt-0.5 hidden text-[13px] text-slate-500 sm:block">{tagline}</p>
                </div>
              </div>

              {/* Pesquisa de cidade â€” lÃ³gica preservada */}
              <div className="relative w-full lg:max-w-md">
                <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] p-1.5 pl-3.5 backdrop-blur-xl transition focus-within:border-gold-500/40">
                  <Search className="h-4 w-4 shrink-0 text-gold-400/80" aria-hidden />
                  <input
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder="Pesquise a sua cidadeâ€¦ (ex.: Braga, Porto, Faro)"
                    className="w-full bg-transparent py-2 text-[14px] text-white placeholder:text-slate-500 focus:outline-none"
                    aria-label="Pesquisar cidade"
                    role="combobox"
                    aria-expanded={showSuggestions}
                    aria-controls="city-suggestions"
                  />
                  {term && (
                    <button
                      onClick={() => setTerm('')}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white"
                      aria-label="Limpar pesquisa"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                {showSuggestions && (
                  <div
                    id="city-suggestions"
                    role="listbox"
                    className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-[12px] border border-white/10 bg-navy-850 shadow-card"
                  >
                    {citiesQuery?.loading ? (
                      <p className="px-4 py-4 text-sm text-slate-400">A pesquisar cidadesâ€¦</p>
                    ) : (results ?? []).length === 0 ? (
                      <p className="px-4 py-4 text-sm text-slate-400">
                        Ainda nÃ£o existe essa cidade.{' '}
                        <ProgramLink to="/cidades" className="text-gold-300 underline">Ver todas as cidades</ProgramLink>
                      </p>
                    ) : (
                      <ul className="max-h-64 overflow-auto py-1">
                        {(results ?? []).slice(0, 7).map((c) => (
                          <li key={c?.id ?? c?.slug ?? Math.random().toString(36)} role="option" aria-selected="false">
                            <button
                              onClick={() => c?.slug && navigate(programPaths.city(prefix, c.slug))}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5"
                            >
                              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-500/10">
                                <MapPin className="h-4 w-4 text-gold-400" aria-hidden />
                              </span>
                              <span>
                                <span className="block text-sm font-semibold text-white">{c?.name ?? 'Cidade'}</span>
                                <span className="block text-xs text-slate-500">{c?.district ?? 'Portugal'}</span>
                              </span>
                              <ChevronRight className="ml-auto h-4 w-4 text-slate-600" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* MÃ©tricas â€” escala reduzida ~25%, dourado sÃ³ no nÃºmero */}
            <dl className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-[12px] border border-white/[0.07] bg-white/[0.06] sm:grid-cols-3">
              {[
                { icon: Landmark, value: `${(cities ?? []).length}+`, label: 'Cidades', hint: 'de norte a sul' },
                { icon: Star, value: `${categoriesQuery?.data?.length ?? 8}`, label: 'Categorias', hint: 'do comÃ©rcio local' },
                { icon: Users, value: '100%', label: 'Voto popular', hint: 'a comunidade decide' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3.5 bg-navy-950/90 px-6 py-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03]">
                    <s.icon className="h-4 w-4 text-gold-400/90" aria-hidden />
                  </span>
                  <span>
                    <dt className="sr-only">{s.label}</dt>
                    <dd className="font-display text-[1.7rem] font-bold leading-none text-white">
                      <span className="text-gold-300/95">{s.value}</span>{' '}
                      <span className="text-[1.05rem] font-semibold text-slate-300">{s.label}</span>
                    </dd>
                    <dd className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">{s.hint}</dd>
                  </span>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* ============ CIDADES EM DESTAQUE ============ */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-6 sm:py-24">
        <SectionHeading
          eyebrow="Portugal de norte a sul"
          title={<>Cidades em destaque</>}
          description="Escolha a sua cidade e descubra as categorias e os negÃ³cios participantes na ediÃ§Ã£o deste ano."
        />
        {citiesQuery?.loading ? (
          <LoadingGrid count={8} />
        ) : (featured ?? []).length === 0 ? (
          <EmptyState title="Sem cidades de momento" description="Estamos a preparar as cidades participantes. Volte em breve." />
        ) : (
          <>
            <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {(featured ?? []).map((city) => (
                <ProgramLink
                  key={city?.id ?? city?.slug ?? city?.name}
                  to={`/cidade/${city?.slug ?? ''}`}
                  className="card-lift group overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.025] hover:border-gold-500/25"
                >
                  <div className="relative flex h-32 items-end overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950 p-4">
                    {city?.image_url ? (
                      <>
                        <img src={city.image_url} alt="" aria-hidden loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                        <div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/25 to-transparent" aria-hidden />
                      </>
                    ) : (
                      <div className="absolute inset-0 bg-hero-radial" aria-hidden />
                    )}
                    <MapPin className="absolute right-4 top-4 h-4 w-4 text-gold-500/50 transition group-hover:text-gold-400/80" />
                    <p className="relative font-display text-4xl font-bold text-white/10">
                      {city?.name?.charAt(0) ?? '?'}
                    </p>
                  </div>
                  <div className="p-5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      {city?.district ?? 'Portugal'}
                    </p>
                    <h3 className="mt-1 font-display text-[1.15rem] font-bold text-white">{city?.name ?? 'Cidade'}</h3>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-400">
                      {city?.description ?? 'Descubra os melhores negÃ³cios locais.'}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-gold-300/90">
                      Explorar cidade <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </ProgramLink>
              ))}
            </div>
            <div className="mt-10 text-center">
              <ProgramLink
                to="/cidades"
                className="btn-ghost-refined"
              >
                Ver todas as cidades <ChevronRight className="h-4 w-4" />
              </ProgramLink>
            </div>
          </>
        )}
      </section>

      <GoldDivider className="mx-auto max-w-5xl px-4" />

      {/* ============ CATEGORIAS ============ */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-6 sm:py-24">
        <SectionHeading
          eyebrow="Do bairro para o paÃ­s"
          title={<>Categorias do prÃ©mio</>}
          description="Da barbearia Ã  pastelaria, cada categoria celebra o melhor do comÃ©rcio local portuguÃªs."
        />
        {categoriesQuery?.loading ? (
          <LoadingGrid count={8} />
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(categoriesQuery?.data ?? []).map((cat) => {
              const Icon = categoryIcon(cat?.icon);
              return (
                <div
                  key={cat?.id ?? cat?.name}
                  className="card-lift rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-5 hover:border-gold-500/25"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-gold-500/20 bg-gold-500/[0.08]">
                    <Icon className="h-[18px] w-[18px] text-gold-400" strokeWidth={2} />
                  </span>
                  <h3 className="mt-4 font-display text-[1.1rem] font-bold text-white">{cat?.name ?? 'Categoria'}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{cat?.description ?? ''}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ============ COMO FUNCIONA ============ */}
      <section id="como-funciona" className="scroll-mt-28 border-y border-white/[0.07] bg-navy-900/50">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 sm:py-24">
          <SectionHeading
            eyebrow="Simples e transparente"
            title={<>Como funciona a votaÃ§Ã£o</>}
            description="Sem contas, sem complicaÃ§Ãµes. Apenas o seu voto a celebrar quem faz bem."
          />
          <ol className="grid gap-4 md:grid-cols-4">
            {[
              { icon: MapPin, step: '1', title: 'Escolha a cidade', text: 'Encontre a sua cidade entre centenas de localidades participantes.' },
              { icon: Star, step: '2', title: 'Escolha a categoria', text: 'Barbearias, restaurantes, pastelarias e muito mais.' },
              { icon: Vote, step: '3', title: 'Apoie o seu favorito', text: 'Um voto por pessoa, por categoria, por cidade e por ediÃ§Ã£o.' },
              { icon: Award, step: '4', title: 'Celebre os vencedores', text: 'Os resultados sÃ£o auditados e publicados no final da ediÃ§Ã£o.' },
            ].map((s) => (
              <li key={s.step} className="relative rounded-[14px] border border-white/[0.08] bg-navy-950/60 p-6">
                <span className="absolute right-5 top-4 font-display text-3xl font-bold text-white/[0.08]">{s.step}</span>
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03]">
                  <s.icon className="h-[18px] w-[18px] text-gold-400/90" />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-white">{s.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ============ CAMPANHA ACTUAL ============ */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-6 sm:py-24">
        <div className="overflow-hidden rounded-[16px] border border-white/[0.08] bg-navy-900/60 p-8 sm:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <Badge>
                <Trophy className="h-3.5 w-3.5" />
                EdiÃ§Ã£o actual
              </Badge>
              <h2 className="editorial-h2 mt-4">
                {campaignQuery?.data?.name ?? 'PrÃ©mios Melhores do Ano Portugal 2026'}
              </h2>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-slate-400">
                {campaignQuery?.data?.start_at && campaignQuery?.data?.end_at ? (
                  <>De {formatDatePt(campaignQuery.data.start_at)} a {formatDatePt(campaignQuery.data.end_at)}.</>
                ) : (
                  <>A ediÃ§Ã£o de {campaignQuery?.data?.year ?? 2026} estÃ¡ em curso em todo o paÃ­s.</>
                )}{' '}
                Os vencedores de cada cidade e categoria recebem o selo oficial dos Melhores do Ano.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <ProgramLink
                  to="/cidades"
                  className="btn-gold-refined"
                >
                  Participar agora <ArrowRight className="h-4 w-4" />
                </ProgramLink>
                {/* FASE 4E: sÃ³ existe quando results_public=true (sem contagens aqui). */}
                {campaignQuery?.data?.results_public === true && (
                  <ProgramLink
                    to="/resultados"
                    className="btn-ghost-refined"
                  >
                    <Trophy className="h-4 w-4" /> Ver resultados oficiais
                  </ProgramLink>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: BadgeCheck, title: 'NegÃ³cios verificados', text: 'Participantes validados por cidade.' },
                { icon: ShieldCheck, title: 'Voto auditado', text: 'Regras antifraude desde a fundaÃ§Ã£o.' },
                { icon: Users, title: 'Escolha popular', text: 'Quem decide Ã© a comunidade local.' },
                { icon: Award, title: 'Selo oficial', text: 'Reconhecimento nacional prestigiante.' },
              ].map((f) => (
                <div key={f.title} className="rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-5">
                  <f.icon className="h-[18px] w-[18px] text-gold-400/90" />
                  <p className="mt-3 text-sm font-semibold text-white">{f.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ PATROCINADORES ============ */}
      <SponsorsStrip />

      {/* ============ CONFIANÃ‡A ============ */}
      <section className="mx-auto max-w-7xl px-5 pb-24 sm:px-6">
        <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.02] p-8 text-center sm:p-12">
          <ShieldCheck className="mx-auto h-8 w-8 text-gold-400/80" />
          <h2 className="editorial-h2 mx-auto mt-4 max-w-xl">
            Um prÃ©mio em que Portugal pode confiar
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            Arquitectura preparada para centenas de cidades e milhares de negÃ³cios, com regras de
            votaÃ§Ã£o justas, auditoria administrativa e protecÃ§Ã£o de dados desde o primeiro dia.
            Consulte o <ProgramLink to="/regulamento" className="text-gold-300 underline">regulamento</ProgramLink> e a{' '}
            <ProgramLink to="/privacidade" className="text-gold-300 underline">polÃ­tica de privacidade</ProgramLink>.
          </p>
        </div>
      </section>
    </div>
  );
}

