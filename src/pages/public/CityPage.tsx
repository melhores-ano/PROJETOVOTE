import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ProgramLink, useProgram } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';
import { ArrowLeft, ArrowRight, MapPin, Trophy, Users } from 'lucide-react';
import { useActiveCampaign, useCity } from '../../hooks/useDirectory';
import { useCityCategories, type CategoryWithCount } from '../../hooks/useEntries';
import { usePublicCategoryAreas } from '../../hooks/useCategoryAreas';
import { groupCategoriesByArea, hasUsableAreas, OTHER_CATEGORIES_LABEL } from '../../lib/categoryAreas';
import { usePageMeta } from '../../components/PageMeta';
import { categoryIcon } from '../../components/icons';
import { EmptyState, LoadingGrid, PageLoading, ErrorState, Eyebrow, Badge } from '../../components/ui';

function CategoryCard({ citySlug, cat }: { citySlug: string; cat: CategoryWithCount }) {
  const Icon = categoryIcon(cat.icon);
  return (
    <ProgramLink
      to={`/${citySlug}/${cat.slug}`}
      className="card-lift group flex items-center gap-4 rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-5 hover:border-gold-500/25"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-gold-500/20 bg-gold-500/[0.08]">
        <Icon className="h-[18px] w-[18px] text-gold-400" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[1.05rem] font-bold text-white">{cat.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500">
          <Users className="h-3.5 w-3.5 text-gold-500/70" />
          {cat.entry_count} {cat.entry_count === 1 ? 'participante' : 'participantes'}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-gold-400/80" />
    </ProgramLink>
  );
}

export default function CityPage() {
  const { citySlug } = useParams<{ citySlug: string }>();
  const { prefix, program } = useProgram();
  const { city, loading, error, refetch } = useCity(citySlug);
  const campaignQuery = useActiveCampaign();
  const categoriesQuery = useCityCategories(campaignQuery.data?.id, city?.id);
  const categories = categoriesQuery.data ?? [];
  // FASE 6.2: áreas ativas do programa atual (navegação Cidade → Área →
  // Categoria). Tabela ausente/sem áreas → [] e a experiência atual é
  // preservada integralmente (backward-compatible).
  const areasQuery = usePublicCategoryAreas();
  const areaGroups = useMemo(
    () => groupCategoriesByArea(categories, areasQuery.data ?? []),
    [categories, areasQuery.data],
  );
  const grouped = hasUsableAreas(areaGroups);
  const busy = loading || campaignQuery.loading;

  usePageMeta(
    city ? `${city.name} · Melhores do Ano` : 'Cidade participante',
    city?.description ?? `Categorias e negócios participantes em ${city?.name ?? 'Portugal'}.`,
    {
      canonicalPath: city ? programPaths.city(prefix, city.slug) : undefined,
      locale: program?.locale ?? 'pt-PT',
    },
  );

  if (busy && !city) {
    return <div className="mx-auto max-w-7xl px-4 sm:px-6"><PageLoading label="A carregar a cidade…" /></div>;
  }
  if (error && !city) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }
  if (!city) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Cidade não encontrada"
          description="A cidade que procura não participa (ainda) nos Melhores do Ano."
          action={<ProgramLink to="/cidades" className="mt-2 rounded-lg bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-navy-950">Ver todas as cidades</ProgramLink>}
        />
      </div>
    );
  }

  const year = campaignQuery.data?.year ?? 2026;
  // FASE 4E: a cidade liga-se aos resultados oficiais só quando publicados
  // (autoridade: campaigns.results_public). Sem contagens nesta página.
  const published = campaignQuery.data?.results_public === true;

  return (
    <div>
      {/* Cabeçalho da cidade */}
      <section className="relative overflow-hidden border-b border-white/10">
        {city.image_url ? (
          <>
            <img src={city.image_url} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/80 to-navy-950/40" aria-hidden />
          </>
        ) : (
          <div className="absolute inset-0 bg-hero-radial" aria-hidden />
        )}
        <div className="relative mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16">
          <ProgramLink to="/cidades" className="inline-flex items-center gap-1.5 text-[13px] text-slate-400 transition hover:text-gold-300">
            <ArrowLeft className="h-4 w-4" /> Todas as cidades
          </ProgramLink>
          <div className="mt-5 flex items-start gap-4">
            <span className="hidden h-12 w-12 items-center justify-center rounded-[12px] border border-gold-500/20 bg-gold-500/[0.08] sm:flex">
              <MapPin className="h-5 w-5 text-gold-400" />
            </span>
            <div>
              <Eyebrow>{city.district ?? 'Portugal'} · Edição {year}</Eyebrow>
              <h1 className="editorial-h1">{city.name}</h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-400">
                {city.description ?? `Descubra as categorias a concurso em ${city.name} e apoie os seus negócios favoritos.`}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categorias com participação efectiva */}
      <section className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16">
        {published && (
          <ProgramLink
            to="/resultados"
            className="mb-8 flex items-center gap-4 rounded-[14px] border border-gold-500/25 bg-gold-500/[0.06] p-5 transition hover:border-gold-500/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-gold-500/20 bg-gold-500/[0.08]">
              <Trophy className="h-5 w-5 text-gold-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-300/90">
                Resultados oficiais de {city.name} publicados
              </span>
              <span className="mt-0.5 block text-sm text-slate-400">
                Ver o apuramento auditado por categoria — 1.º, 2.º e 3.º lugar.
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-gold-300/80" />
          </ProgramLink>
        )}
        <h2 className="editorial-h3 mb-2">Categorias a concurso em {city.name}</h2>
        <p className="mb-8 text-[14px] text-slate-500">Apenas categorias com negócios inscritos na edição {year}. Escolha uma para conhecer os participantes.</p>
        {categoriesQuery.loading ? (
          <LoadingGrid count={6} />
        ) : categories.length === 0 ? (
          <EmptyState
            title="Participantes a serem anunciados"
            description={`As categorias de ${city.name} na edição ${year} ainda estão a ser preparadas. Volte em breve.`}
          />
        ) : (
          grouped ? (
            <div className="space-y-10">
              {areaGroups.map((group) => (
                <section key={group.area ? group.area.id : 'outras'} aria-label={group.area ? group.area.name : OTHER_CATEGORIES_LABEL}>
                  <div className="mb-4 flex items-baseline gap-3">
                    <h3 className="font-display text-xl font-bold text-white">
                      {group.area ? group.area.name : OTHER_CATEGORIES_LABEL}
                    </h3>
                    <span className="text-[13px] text-slate-500">
                      {group.categories.length} {group.categories.length === 1 ? 'categoria' : 'categorias'}
                    </span>
                  </div>
                  {group.area?.description ? (
                    <p className="mb-4 max-w-2xl text-[14px] leading-relaxed text-slate-500">{group.area.description}</p>
                  ) : null}
                  <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.categories.map((cat) => (
                      <CategoryCard key={cat.id} citySlug={city.slug} cat={cat} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((cat) => (
                <CategoryCard key={cat.id} citySlug={city.slug} cat={cat} />
              ))}
            </div>
          )
        )}
        {categories.length > 0 && (
          <div className="mt-8">
            <Badge tone="navy">
              {categories.reduce((n, c) => n + c.entry_count, 0)} participações em {categories.length} {categories.length === 1 ? 'categoria' : 'categorias'}
            </Badge>
          </div>
        )}
      </section>
    </div>
  );
}
