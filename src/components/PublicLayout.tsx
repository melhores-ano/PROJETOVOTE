import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Menu, X, MapPin, Trophy, ShieldCheck, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { useActiveCampaign } from '../hooks/useDirectory';
import { useProgramPath } from '../hooks/useProgram';
import { BrandLogo } from './BrandLogo';
import { brand } from '../config/brand';

/** FASE 5C.3.4 — caminhos relativos ao programa; o prefixo (/pt/) é aplicado no render. */
const NAV = [
  { to: '/cidades', label: 'Cidades' },
  { to: '/resultados', label: 'Resultados' },
  { to: '/sobre', label: 'Sobre' },
  { to: '/regulamento', label: 'Regulamento' },
  { to: '/contactos', label: 'Contactos' },
];

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const buildPath = useProgramPath();
  const campaignQuery = useActiveCampaign();
  const editionYear = campaignQuery.data?.year ?? 2026;
  const copyrightYear = new Date().getFullYear();
  const homePath = buildPath('/');
  const citiesPath = buildPath('/cidades');

  return (
    <div className="min-h-screen bg-navy-950 font-sans text-slate-100">
      {/* Barra superior — FASE 5B.4: header editorial, silencioso e espaçado */}
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-navy-950/90 backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-500/25 to-transparent" aria-hidden />
        <div className="mx-auto flex h-[84px] max-w-7xl items-center justify-between gap-6 px-5 sm:h-[88px] sm:px-6 lg:gap-8">
          <Link to={homePath} className="group flex min-w-0 flex-1 items-center gap-4 sm:gap-4 lg:flex-none" aria-label={`${brand.parentBrandName} — ${brand.awardName}, página inicial`}>
            <span className="flex shrink-0 items-center rounded-lg py-1 pr-1">
              <BrandLogo variant="public" linkToHome={false} className="transition duration-300 group-hover:brightness-105" />
            </span>
            <span className="hidden min-w-0 flex-col justify-center border-l border-white/10 pl-4 leading-tight min-[420px]:flex">
              <span className="text-[9px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                {brand.parentBrandName}
              </span>
              <span className="mt-0.5 truncate font-display text-[15px] font-bold text-white">
                {brand.awardName}
              </span>
              <span className="mt-0.5 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-gold-400/90">
                <span className="inline-block h-px w-4 bg-gold-500/50" aria-hidden />
                Edição {editionYear}
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1.5 lg:flex" aria-label="Navegação principal">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={buildPath(item.to)}
                className={({ isActive }) => cn(
                  'rounded-lg px-3.5 py-2 text-[13.5px] font-medium tracking-wide transition',
                  isActive ? 'bg-white/[0.07] text-gold-300' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white',
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <button
              onClick={() => navigate(citiesPath)}
              className="btn-gold-refined !min-h-[44px] !px-5 !text-[13.5px]"
            >
              <MapPin className="h-4 w-4" />
              Escolher a minha cidade
            </button>
          </div>

          <button
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {open && (
          <nav className="border-t border-white/10 bg-navy-900 px-4 py-3 lg:hidden" aria-label="Menu móvel">
            <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <BrandLogo variant="admin" />
              <div className="leading-tight">
                <p className="text-[13px] font-semibold text-white">{brand.awardName}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-400">
                  Edição {editionYear}
                </p>
              </div>
            </div>
            {[{ to: '/', label: 'Início' }, ...NAV].map((item) => (
              <NavLink
                key={item.to}
                to={buildPath(item.to)}
                onClick={() => setOpen(false)}
                className={({ isActive }) => cn(
                  'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium',
                  isActive ? 'bg-white/10 text-gold-300' : 'text-slate-300 hover:bg-white/5',
                )}
              >
                {item.label}
                <ChevronRight className="h-4 w-4 opacity-50" />
              </NavLink>
            ))}
            <button
              onClick={() => { setOpen(false); navigate(citiesPath); }}
              className="btn-gold-refined mt-2 w-full"
            >
              <MapPin className="h-4 w-4" />
              Escolher a minha cidade
            </button>
          </nav>
        )}
      </header>

      <main className="min-h-[60vh]">
        <Outlet />
      </main>

      {/* Rodapé — editorial, espaçado */}
      <footer className="border-t border-white/[0.07] bg-navy-900/70">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <BrandLogo variant="footer" linkToHome />
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {brand.parentBrandName}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">{brand.awardName}</p>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-slate-400">
              O prémio nacional que celebra os melhores negócios locais de Portugal —
              escolhidos pelas pessoas, cidade a cidade, categoria a categoria.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-1.5 text-xs font-medium text-emerald-300/90">
              <ShieldCheck className="h-3.5 w-3.5" />
              Votação justa e auditada
            </p>
          </div>
          <div>
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Explorar</p>
            <ul className="space-y-2.5 text-[14px] text-slate-400">
              <li><Link className="transition hover:text-gold-300" to={buildPath('/cidades')}>Todas as cidades</Link></li>
              <li><Link className="transition hover:text-gold-300" to={buildPath('/resultados')}>Resultados</Link></li>
              <li><Link className="transition hover:text-gold-300" to={buildPath('/sobre')}>Sobre o prémio</Link></li>
              <li><Link className="transition hover:text-gold-300" to={buildPath('/regulamento')}>Regulamento</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Informações</p>
            <ul className="space-y-2.5 text-[14px] text-slate-400">
              <li><Link className="transition hover:text-gold-300" to={buildPath('/privacidade')}>Privacidade</Link></li>
              <li><Link className="transition hover:text-gold-300" to={buildPath('/contactos')}>Contactos</Link></li>
              <li className="flex items-center gap-2 text-slate-500">
                <Trophy className="h-3.5 w-3.5 text-gold-500/70" />
                Edição {editionYear}
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6">
            <p>© {copyrightYear} {brand.parentBrandName} — {brand.awardName}. Todos os direitos reservados.</p>
            <p>A sua cidade. A sua escolha. O seu voto.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
