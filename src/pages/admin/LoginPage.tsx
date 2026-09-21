import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/AuthContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { BrandLogo } from '../../components/BrandLogo';
import { brand } from '../../config/brand';

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.ok) navigate('/admin', { replace: true });
    else setError(result.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 font-sans">
      <div className="w-full max-w-md">
        <Link to="/pt/" className="mb-6 flex flex-col items-center gap-3 text-center" aria-label={`${brand.parentBrandName} — página inicial`}>
          <BrandLogo variant="login" />
          <span className="leading-tight">
            <span className="block text-[11px] font-bold uppercase tracking-[0.24em] text-gold-400">
              Administração
            </span>
            <span className="mt-0.5 block text-sm font-medium text-slate-300">{brand.awardName}</span>
          </span>
        </Link>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-card backdrop-blur">
          <h1 className="font-display text-2xl font-bold text-white">Iniciar sessão</h1>
          <p className="mt-1 text-sm text-slate-400">Acesso restrito a administradores autorizados.</p>

          {!isSupabaseConfigured && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Supabase por configurar — a autenticação ficará disponível após definir as variáveis de ambiente.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
              {error}
            </p>
          )}

          <label className="mt-5 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@melhoresdoano.pt"
              className="w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Palavra-passe</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'A verificar…' : 'Entrar no painel'}
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            As contas de administrador são criadas pela equipa técnica (papel <code>admin</code> ou{' '}
            <code>super_admin</code> na tabela <code>profiles</code>). Não existe auto-registo público.
          </p>
        </form>

        <p className="mt-5 text-center text-xs text-slate-600">
          <Link to="/pt/" className="hover:text-gold-300">← Voltar ao sítio público</Link>
        </p>
      </div>
    </div>
  );
}
