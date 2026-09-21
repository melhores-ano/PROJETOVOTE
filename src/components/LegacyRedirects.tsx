/**
 * THE BEST EUROPA — FASE 5C.3.4 — Redirects de compatibilidade (URLs antigas).
 * As URLs antigas NÃO quebram: redirecionam (replace) para a versão
 * canónica /pt/. Nunca duplicar conteúdo nas duas URLs.
 */
import { Navigate, useParams } from 'react-router-dom';
import { useActiveCampaign, useCategories, useCities, useCity } from '../hooks/useDirectory';
import { PageLoading } from '../components/ui';
import NotFoundPage from '../pages/public/NotFoundPage';
import { programPaths } from '../lib/programRoute';

/** / → /pt/ */
export function RootRedirect() {
  return <Navigate to="/pt/" replace />;
}

/** Redirect estático simples para a versão /pt/. */
export function StaticRedirect({ to }: { to: string }) {
  return <Navigate to={to} replace />;
}

/**
 * Gate do segmento raiz: decide entre rota de programa e legado.
 * Chamado pelo router quando o primeiro segmento NÃO é estático.
 * - 'pt' nunca chega aqui (rota de programa dedicada tem prioridade).
 * - slug de cidade PT conhecida → redirect /pt/cidade/:slug.
 * - qualquer outro (fr, be, xx, …) → Not Found fail-closed, SEM dados PT.
 */
export function RootSegmentGate() {
  const { rootSegment } = useParams<{ rootSegment: string }>();
  const citiesQuery = useCities();
  const slug = (rootSegment ?? '').toLowerCase();

  if (citiesQuery.loading && (citiesQuery.data ?? []).length === 0) {
    return (
      <div className="min-h-screen bg-navy-950">
        <PageLoading label="A carregar…" />
      </div>
    );
  }

  const city = (citiesQuery.data ?? []).find((c) => c.slug === slug) ?? null;
  if (city) {
    return <Navigate to={programPaths.city('pt', city.slug)} replace />;
  }
  // Não é cidade PT: pode ser tentativa de outro país (/fr/) ou slug
  // inválido — em ambos os casos Not Found SEM fallback Portugal.
  return <NotFoundPage />;
}

/** /:citySlug/:categorySlug (legado) → /pt/:city/:category. */
export function LegacyCityCategoryRedirect() {
  const { citySlug = '', categorySlug = '' } = useParams<{ citySlug: string; categorySlug: string }>();
  const { city, loading } = useCity(citySlug);
  const categoriesQuery = useCategories();

  if (loading || categoriesQuery.loading) {
    return (
      <div className="min-h-screen bg-navy-950">
        <PageLoading label="A carregar…" />
      </div>
    );
  }
  const category = (categoriesQuery.data ?? []).find((c) => c.slug === categorySlug) ?? null;
  if (city && category) {
    return <Navigate to={programPaths.category('pt', city.slug, category.slug)} replace />;
  }
  return <NotFoundPage />;
}

/** /:citySlug/:categorySlug/resultados (legado) → /pt/:city/:category/resultados. */
export function LegacyCategoryResultRedirect() {
  const { citySlug = '', categorySlug = '' } = useParams<{ citySlug: string; categorySlug: string }>();
  const { city, loading } = useCity(citySlug);
  const categoriesQuery = useCategories();

  if (loading || categoriesQuery.loading) {
    return (
      <div className="min-h-screen bg-navy-950">
        <PageLoading label="A carregar…" />
      </div>
    );
  }
  const category = (categoriesQuery.data ?? []).find((c) => c.slug === categorySlug) ?? null;
  if (city && category) {
    return <Navigate to={programPaths.categoryResults('pt', city.slug, category.slug)} replace />;
  }
  return <NotFoundPage />;
}

/**
 * /:year/:citySlug/:categorySlug/resultados (legado com ano)
 * → /pt/:city/:category/resultados.
 */
export function LegacyYearResultRedirect() {
  const { year = '', citySlug = '', categorySlug = '' } = useParams<{
    year: string;
    citySlug: string;
    categorySlug: string;
  }>();
  const { city, loading } = useCity(citySlug);
  const categoriesQuery = useCategories();
  const campaignQuery = useActiveCampaign();

  if (loading || categoriesQuery.loading || campaignQuery.loading) {
    return (
      <div className="min-h-screen bg-navy-950">
        <PageLoading label="A carregar…" />
      </div>
    );
  }
  const category = (categoriesQuery.data ?? []).find((c) => c.slug === categorySlug) ?? null;
  const yearMatch = !year || String(campaignQuery.data?.year ?? 2026) === year;
  if (city && category && yearMatch) {
    return <Navigate to={programPaths.categoryResults('pt', city.slug, category.slug)} replace />;
  }
  return <NotFoundPage />;
}
