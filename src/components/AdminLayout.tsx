import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Megaphone, MapPin, Tags, Store, Users,
  BarChart3, ShieldAlert, Settings, LogOut, Trophy, Handshake, KeyRound,
  Upload, ScrollText, Medal, BadgeCheck,
} from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { AdminProgramProvider } from '../hooks/useAdminProgram';
import { AdminProgramSelector } from './AdminProgramSelector';
import { cn } from '../lib/utils';
import { PageLoading } from './ui';
import { BrandLogo } from './BrandLogo';
import { brand } from '../config/brand';

import type { LucideIcon } from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  superOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/admin', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/admin/campanhas', label: 'Campanhas', icon: Megaphone },
  { to: '/admin/cidades', label: 'Cidades', icon: MapPin },
  { to: '/admin/categorias', label: 'Categorias', icon: Tags },
  { to: '/admin/modalidades', label: 'Modalidades', icon: Medal },
  { to: '/admin/distincoes', label: 'Distinções', icon: BadgeCheck },
  { to: '/admin/empresas', label: 'Empresas', icon: Store },
  { to: '/admin/participantes', label: 'Participantes', icon: Users },
  { to: '/admin/importar', label: 'Importar CSV', icon: Upload },
  { to: '/admin/votos', label: 'Votos', icon: BarChart3 },
  { to: '/admin/resultados', label: 'Resultados', icon: Trophy },
  { to: '/admin/patrocinadores', label: 'Patrocinadores', icon: Handshake },
  { to: '/admin/utilizadores', label: 'Utilizadores', icon: KeyRound, superOnly: true },
  { to: '/admin/seguranca', label: 'Segurança', icon: ShieldAlert },
  { to: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
  { to: '/admin/configuracoes', label: 'Configurações', icon: Settings },
];

export function ProtectedRoute() {
  const { isAdmin, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950">
        <PageLoading label="A verificar as permissões…" />
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/admin/login" replace />;
  return (
    <AdminProgramProvider>
      <AdminShell />
    </AdminProgramProvider>
  );
}

/** Gate adicional: apenas super_admin (gestão de utilizadores). */
export function RequireSuperAdmin() {
  const { role, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950">
        <PageLoading label="A verificar as permissões…" />
      </div>
    );
  }
  if (role !== 'super_admin') return <Navigate to="/admin" replace />;
  return <Outlet />;
}

function AdminShell() {
  const { email, role, signOut } = useAuth();
  const navigate = useNavigate();
  const visibleItems = ITEMS.filter((item) => !item.superOnly || role === 'super_admin');

  async function handleLogout() {
    await signOut();
    navigate('/admin/login');
  }

  return (
    <div className="min-h-screen bg-navy-950 font-sans text-slate-100 lg:flex">
      {/* Sidebar */}
      <aside className="border-b border-white/10 bg-navy-900 lg:flex lg:min-h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
        <Link to="/admin" className="flex flex-col gap-1.5 px-5 pb-4 pt-5" aria-label={`${brand.parentBrandName} — Administração`}>
          <BrandLogo variant="admin" />
          <span className="leading-tight">
            <span className="block text-[10px] font-bold uppercase tracking-[0.24em] text-gold-400">
              Administração
            </span>
            <span className="block text-xs font-medium text-slate-400">
              {brand.awardName}
            </span>
          </span>
        </Link>
        {/* FASE 5C.3.6 — Contexto Programa + Edição (única fonte de verdade). */}
        <div className="px-3 pb-2 lg:px-3">
          <AdminProgramSelector />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3" aria-label="Administração">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-gold-500/15 text-gold-300' : 'text-slate-400 hover:bg-white/5 hover:text-white',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-white/10 p-4 lg:block">
          <p className="truncate text-xs font-medium text-slate-300">{email}</p>
          <p className="mb-3 text-[11px] uppercase tracking-wider text-gold-400">
            {role === 'super_admin' ? 'Super administrador' : 'Administrador'}
          </p>
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-red-500/40 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Terminar sessão
          </button>
          <Link to="/pt/" className="mt-2 block text-center text-xs text-slate-500 hover:text-gold-300">
            ← Ver sítio público
          </Link>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 lg:min-h-screen">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-8 lg:hidden">
          <p className="truncate text-xs text-slate-400">{email}</p>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
