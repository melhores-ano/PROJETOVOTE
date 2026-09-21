import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, MapPin, Users } from 'lucide-react';
import { useActiveCampaign, useCategories, useCities } from '../../hooks/useDirectory';
import { useCityCategories } from '../../hooks/useEntries';
import { usePageMeta } from '../../components/PageMeta';
import { categoryIcon } from '../../components/icons';
import { EmptyState, LoadingGrid, SectionHeading } from '../../components/ui';
import { useProgram } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';

/**
 * FASE 5C.3.4 — Panorama da categoria dentro do programa actual.
 * Rota: /pt/categoria/:categorySlug (e futuros /fr/... sem dados PT).
 * Reutiliza componentes existentes; lista as cidades do programa com
 * participação efectiva na categoria. Fail-closed: categoria de outro
 * programa ou inexistente → Not Found.
 */
export default function CategoryLandingPage() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const { prefix, program, buildPath } = useProgram();
  const categoriesQuery = useCategories();
  const citiesQuery = useCities();
  const campaignQuery = useActiveCampaign();

  const category = useMemo(
    () => (categoriesQuery.data ?? []).find((c) => c.slug === categorySlug) ?? null,
    [categoriesQuery.data, categorySlug],
  );

  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);

  usePageMeta(
    category ? `${category.name} · Melhores do Ano` : 'Categoria a concurso',
    category?.description ?? `Negócios participantes em ${category?.name ?? 'Portugal'}.`,
    {
      canonicalPath: category ? programPaths.categoryLanding(prefix, category.slug) : undefined,
      locale: program?.locale ?? 'pt-PT',
    },
  );

  const busy = categoriesQuery.loading || citiesQuery.loading || campaignQuery.loading;

  if (busy && !category) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <LoadingGrid count={6} />
      </div>
    );
  }

  if (!category) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Categoria não encontrada"
          description="A categoria que procura não existe neste programa ou ainda não está activa."
          action={
            <Link
              to={buildPath('/cidades')}
              className="mt-2 rounded-lg bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-navy-950"
            >
              Explorar cidades
            </Link>
          }
        />
      </div>
    );
  }

  const Icon = categoryIcon(category.icon);

  return (
    <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16">
      <Link
        to={buildPath('/cidades')}
        className="inline-flex items-center gap-1.5 text-[13px] text-slate-400 transition hover:text-gold-300"
      >
        <ArrowLeft className="h-4 w-4" /> Todas as cidades
      </Link>

      <div className="mt-5 flex items-start gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-gold-500/20 bg-gold-500/[0.08]">
          <Icon className="h-5 w-5 text-gold-400" strokeWidth={2} />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            {program?.name ?? 'Melhores do Ano Portugal'} · Edição {campaignQuery.data?.year ?? 2026}
          </p>
          <h1 className="editorial-h1">{category.name}</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-400">
            {category.description ?? `Descubra os negócios de ${category.name} por cidade.`}
          </p>
        </div>
      </div>

      <section className="mt-12">
        <SectionHeading
          eyebrow="Onde votar"
          title={<>Cidades com {category.name}</>}
          description={`Escolha uma cidade para ver os participantes de ${category.name} na edição actual.`}
        />
        {cities.length === 0 ? (
          <EmptyState
            title="Sem cidades de momento"
            description="Estamos a preparar as cidades participantes. Volte em breve."
          />
        ) : (
          <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cities.map((city) => (
              <CityCategoryCard
                key={city.id}
                cityId={city.id}
                cityName={city.name}
                citySlug={city.slug}
                district={city.district}
                categoryId={category.id}
                categorySlug={category.slug}
                campaignId={campaignQuery.data?.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CityCategoryCard({
  cityId,
  cityName,
  citySlug,
  district,
  categoryId,
  categorySlug,
  campaignId,
}: {
  cityId: string;
  cityName: string;
  citySlug: string;
  district: string | null;
  categoryId: string;
  categorySlug: string;
  campaignId: string | undefined;
}) {
  const { buildPath } = useProgram();
  const catsQuery = useCityCategories(campaignId, cityId);
  const entry = (catsQuery.data ?? []).find((c) => c.id === categoryId) ?? null;
  if (!catsQuery.loading && !entry) return null;
  return (
    <Link
      to={buildPath(`/${citySlug}/${categorySlug}`)}
      className="card-lift group overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.025] hover:border-gold-500/25"
    >
      <div className="relative flex h-28 items-end overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950 p-4">
        <div className="absolute inset-0 bg-hero-radial" aria-hidden />
        <MapPin className="absolute right-4 top-4 h-4 w-4 text-gold-500/50 transition group-hover:text-gold-400/80" />
        <p className="relative font-display text-3xl font-bold text-white/10">{cityName.charAt(0)}</p>
      </div>
      <div className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          {district ?? 'Portugal'}
        </p>
        <h3 className="mt-1 font-display text-[1.15rem] font-bold text-white">{cityName}</h3>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-slate-500">
          <Users className="h-3.5 w-3.5 text-gold-500/70" />
          {catsQuery.loading ? 'A verificar…' : `${entry?.entry_count ?? 0} participantes`}
        </p>
        <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-gold-300/90">
          Ver participantes <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
