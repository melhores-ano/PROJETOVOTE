import { Suspense, lazy, useEffect } from 'react';
import { HashRouter, BrowserRouter, Route, Routes, useLocation, useParams, Outlet } from 'react-router-dom';
import { AuthProvider } from './hooks/AuthContext';
import { useSiteConfig } from './hooks/useDirectory';
import { ProgramProvider, useProgram } from './hooks/useProgram';
import { PublicLayout } from './components/PublicLayout';
import { ProtectedRoute, RequireSuperAdmin } from './components/AdminLayout';
import { PageLoading } from './components/ui';
import { PageMeta } from './components/PageMeta';
import {
  LegacyCategoryResultRedirect,
  LegacyCityCategoryRedirect,
  LegacyYearResultRedirect,
  RootRedirect,
  RootSegmentGate,
  StaticRedirect,
} from './components/LegacyRedirects';
import { programPaths } from './lib/programRoute';

/**
 * FASE 5C.3.4 — Router multi-programa.
 * - Programa real único: /pt/ (Melhores do Ano Portugal).
 * - URLs antigas → redirect (replace) para a versão canónica /pt/.
 * - /fr/, /be/, /xx/ → Not Found fail-closed, SEM dados PT.
 * - /admin* intacto, SEM prefixo /pt/.
 */

/**
 * Modo do router configurável por ambiente:
 * - `hash` (omissão): funciona em qualquer alojamento estático / preview.
 * - `browser`: URLs limpas (/pt/...) — exige rewrites no servidor em produção.
 */
const Router = import.meta.env.VITE_ROUTER_MODE === 'browser' ? BrowserRouter : HashRouter;

/* Code-splitting por rota: o bundle público inicial não carrega o admin e vice-versa. */
const HomePage = lazy(() => import('./pages/public/HomePage'));
const CitiesPage = lazy(() => import('./pages/public/CitiesPage'));
const CityPage = lazy(() => import('./pages/public/CityPage'));
const CategoryLandingPage = lazy(() => import('./pages/public/CategoryLandingPage'));
const CategoryPage = lazy(() => import('./pages/public/CategoryPage'));
const CategoryResultPage = lazy(() => import('./pages/public/CategoryResultPage'));
const BusinessPage = lazy(() => import('./pages/public/BusinessPage'));
const ResultsPage = lazy(() => import('./pages/public/ResultsPage'));
const AboutPage = lazy(() => import('./pages/public/AboutPage'));
const RulesPage = lazy(() => import('./pages/public/RulesPage'));
const PrivacyPage = lazy(() => import('./pages/public/PrivacyPage'));
const ContactPage = lazy(() => import('./pages/public/ContactPage'));
const MaintenancePage = lazy(() => import('./pages/public/MaintenancePage'));
const NotFoundPage = lazy(() => import('./pages/public/NotFoundPage'));

const LoginPage = lazy(() => import('./pages/admin/LoginPage'));
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const CampaignsPage = lazy(() => import('./pages/admin/CampaignsPage'));
const CitiesAdminPage = lazy(() => import('./pages/admin/CitiesAdminPage'));
const CategoriesAdminPage = lazy(() => import('./pages/admin/CategoriesAdminPage'));
const ModalitiesAdminPage = lazy(() => import('./pages/admin/ModalitiesAdminPage'));
const DistinctionsAdminPage = lazy(() => import('./pages/admin/DistinctionsAdminPage'));
const BusinessesAdminPage = lazy(() => import('./pages/admin/BusinessesAdminPage'));
const EntriesAdminPage = lazy(() => import('./pages/admin/EntriesAdminPage'));
const CsvImportPage = lazy(() => import('./pages/admin/CsvImportPage'));
const AuditLogPage = lazy(() => import('./pages/admin/AuditLogPage'));
const VotesAdminPage = lazy(() => import('./pages/admin/VotesAdminPage'));
const ResultsAdminPage = lazy(() => import('./pages/admin/ResultsAdminPage'));
const SponsorsAdminPage = lazy(() => import('./pages/admin/SponsorsAdminPage'));
const UsersAdminPage = lazy(() => import('./pages/admin/UsersAdminPage'));
const SecurityAdminPage = lazy(() => import('./pages/admin/SecurityAdminPage'));
const SettingsAdminPage = lazy(() => import('./pages/admin/SettingsAdminPage'));

const PT = 'pt';

/** Envolve uma página lazy com a sua meta estática de SEO. */
function withMeta(element: React.ReactNode, title: string, description?: string, canonicalPath?: string): React.ReactNode {
  return (
    <>
      <PageMeta title={title} description={description} canonicalPath={canonicalPath} locale="pt-PT" />
      {element}
    </>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-navy-950">
      <PageLoading label="A carregar…" />
    </div>
  );
}

/**
 * Gate do programa /pt/: resolve o contexto pela rota (fail-closed) e
 * aplica o modo de manutenção ao sítio público. A administração não
 * passa por aqui.
 */
function ProgramGate() {
  return (
    <ProgramProvider prefix={PT}>
      <ProgramMaintenanceGate />
    </ProgramProvider>
  );
}

function ProgramMaintenanceGate() {
  const program = useProgram();
  const config = useSiteConfig();

  if (program.status === 'loading' || config.loading) {
    return <LoadingFallback />;
  }
  // Programa por resolver/inactivo com backend configurado → Not Found,
  // SEM fallback Portugal (fail-closed). Preview sem backend rende em
  // modo fallback (status 'ready' com programa PT local).
  if (program.status !== 'ready') {
    return <NotFoundPage />;
  }
  // Modo de manutenção: o sítio público é suspenso, a administração continua acessível.
  if (config.data?.maintenanceMode) {
    return (
      <Routes>
        <Route path="*" element={<MaintenancePage />} />
      </Routes>
    );
  }
  return <Outlet />;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Administração — intacta, SEM prefixo /pt/ */}
      <Route path="admin/login" element={withMeta(<LoginPage />, 'Administração — Iniciar sessão')} />
      <Route element={<ProtectedRoute />}>
        <Route path="admin" element={withMeta(<DashboardPage />, 'Administração — Painel')} />
        <Route path="admin/campanhas" element={withMeta(<CampaignsPage />, 'Administração — Campanhas')} />
        <Route path="admin/cidades" element={withMeta(<CitiesAdminPage />, 'Administração — Cidades')} />
        <Route path="admin/categorias" element={withMeta(<CategoriesAdminPage />, 'Administração — Categorias')} />
        <Route path="admin/modalidades" element={withMeta(<ModalitiesAdminPage />, 'Administração — Modalidades')} />
        <Route path="admin/distincoes" element={withMeta(<DistinctionsAdminPage />, 'Administração — Distinções')} />
        <Route path="admin/empresas" element={withMeta(<BusinessesAdminPage />, 'Administração — Empresas')} />
        <Route path="admin/participantes" element={withMeta(<EntriesAdminPage />, 'Administração — Participantes')} />
        <Route path="admin/importar" element={withMeta(<CsvImportPage />, 'Administração — Importação CSV')} />
        <Route path="admin/auditoria" element={withMeta(<AuditLogPage />, 'Administração — Auditoria')} />
        <Route path="admin/votos" element={withMeta(<VotesAdminPage />, 'Administração — Votos')} />
        <Route path="admin/resultados" element={withMeta(<ResultsAdminPage />, 'Administração — Resultados')} />
        <Route path="admin/patrocinadores" element={withMeta(<SponsorsAdminPage />, 'Administração — Patrocinadores')} />
        <Route element={<RequireSuperAdmin />}>
          <Route path="admin/utilizadores" element={withMeta(<UsersAdminPage />, 'Administração — Utilizadores')} />
        </Route>
        <Route path="admin/seguranca" element={withMeta(<SecurityAdminPage />, 'Administração — Segurança')} />
        <Route path="admin/configuracoes" element={withMeta(<SettingsAdminPage />, 'Administração — Configurações')} />
      </Route>

      {/* Programa Portugal — rota canónica /pt/ */}
      <Route path="pt" element={<ProgramGate />}>
        <Route element={<PublicLayout />}>
          <Route index element={withMeta(<HomePage />, 'Os Melhores do Ano em Portugal', 'A sua cidade. A sua escolha. O seu voto. Descubra e celebre os melhores negócios locais de Portugal.', programPaths.home(PT))} />
          <Route path="cidades" element={withMeta(<CitiesPage />, 'Cidades participantes', 'Escolha a sua cidade e descubra as categorias e negócios participantes nos Melhores do Ano.', programPaths.cities(PT))} />
          <Route path="cidade/:citySlug" element={withMeta(<CityPage />, 'Cidade participante')} />
          <Route path="categoria/:categorySlug" element={withMeta(<CategoryLandingPage />, 'Categoria a concurso')} />
          <Route path="empresa/:businessSlug" element={withMeta(<BusinessPage />, 'Empresa participante')} />
          <Route path="resultados" element={withMeta(<ResultsPage />, 'Resultados oficiais', 'Os vencedores auditados de cada cidade e categoria dos Melhores do Ano Portugal.', programPaths.results(PT))} />
          <Route path="resultados/:categorySlug" element={withMeta(<ResultsPage />, 'Resultados oficiais', 'Os vencedores auditados de cada cidade e categoria dos Melhores do Ano Portugal.')} />
          <Route path="sobre" element={withMeta(<AboutPage />, 'Sobre o prémio', 'O reconhecimento nacional dos negócios locais escolhidos pelas pessoas.', programPaths.about(PT))} />
          <Route path="regulamento" element={withMeta(<RulesPage />, 'Regulamento', 'As regras oficiais que garantem uma votação justa em todas as cidades.', programPaths.rules(PT))} />
          <Route path="privacidade" element={withMeta(<PrivacyPage />, 'Política de Privacidade', 'Como protegemos os dados de quem vota, participa e administra.', programPaths.privacy(PT))} />
          <Route path="contactos" element={withMeta(<ContactPage />, 'Contactos', 'Fale com a organização dos Melhores do Ano Portugal.', programPaths.contact(PT))} />
          {/* Rotas de compatibilidade sob o prefixo (padrão antigo) */}
          <Route path=":citySlug" element={withMeta(<CityPage />, 'Cidade participante')} />
          <Route path=":citySlug/:categorySlug" element={withMeta(<CategoryPage />, 'Categoria a concurso')} />
          <Route path=":citySlug/:categorySlug/resultados" element={<CategoryResultPage />} />
          <Route path=":year/:citySlug/:categorySlug/resultados" element={<CategoryResultPage />} />
          <Route path="404" element={withMeta(<NotFoundPage />, 'Página não encontrada')} />
          <Route path="*" element={withMeta(<NotFoundPage />, 'Página não encontrada')} />
        </Route>
      </Route>

      {/* Redirects legados → versão canónica /pt/ (replace, sem duplicar conteúdo) */}
      <Route index element={<RootRedirect />} />
      <Route path="cidades" element={<StaticRedirect to={programPaths.cities(PT)} />} />
      <Route path="cidade/:citySlug" element={<LegacyCityRedirect />} />
      <Route path="categoria/:categorySlug" element={<LegacyCategoryRedirect />} />
      <Route path="empresa/:businessSlug" element={<LegacyBusinessRedirect />} />
      <Route path="resultados" element={<StaticRedirect to={programPaths.results(PT)} />} />
      <Route path="resultados/:categorySlug" element={<LegacyResultsCategoryRedirect />} />
      <Route path="sobre" element={<StaticRedirect to={programPaths.about(PT)} />} />
      <Route path="regulamento" element={<StaticRedirect to={programPaths.rules(PT)} />} />
      <Route path="privacidade" element={<StaticRedirect to={programPaths.privacy(PT)} />} />
      <Route path="contactos" element={<StaticRedirect to={programPaths.contact(PT)} />} />
      <Route path="404" element={<StaticRedirect to={programPaths.notFound(PT)} />} />
      <Route path=":citySlug/:categorySlug/resultados" element={<LegacyCategoryResultRedirect />} />
      <Route path=":year/:citySlug/:categorySlug/resultados" element={<LegacyYearResultRedirect />} />
      <Route path=":citySlug/:categorySlug" element={<LegacyCityCategoryRedirect />} />
      {/* Segmento raiz: cidade PT legada → /pt/cidade/:slug; resto → Not Found fail-closed */}
      <Route path=":rootSegment" element={<RootSegmentGate />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/** /cidade/:slug (legado) → /pt/cidade/:slug. */
function LegacyCityRedirect() {
  const { citySlug = '' } = useParams<{ citySlug: string }>();
  return <StaticRedirect to={programPaths.city(PT, citySlug)} />;
}

/** /categoria/:slug (legado) → /pt/categoria/:slug. */
function LegacyCategoryRedirect() {
  const { categorySlug = '' } = useParams<{ categorySlug: string }>();
  return <StaticRedirect to={programPaths.categoryLanding(PT, categorySlug)} />;
}

/** /empresa/:slug (legado) → /pt/empresa/:slug. */
function LegacyBusinessRedirect() {
  const { businessSlug = '' } = useParams<{ businessSlug: string }>();
  return <StaticRedirect to={programPaths.business(PT, businessSlug)} />;
}

/** /resultados/:categorySlug (legado) → /pt/resultados/:categorySlug. */
function LegacyResultsCategoryRedirect() {
  const { categorySlug = '' } = useParams<{ categorySlug: string }>();
  return <StaticRedirect to={programPaths.resultsByCategory(PT, categorySlug)} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <ScrollToTop />
        <Suspense fallback={<LoadingFallback />}>
          <AppRoutes />
        </Suspense>
      </Router>
    </AuthProvider>
  );
}
