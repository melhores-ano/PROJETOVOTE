import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, MailCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/AuthContext';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { BrandLogo } from '../../components/BrandLogo';
import { brand } from '../../config/brand';

type LoginMode = 'login' | 'forgot' | 'forgot-sent';

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<LoginMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.ok) navigate('/admin', { replace: true });
    else setError(result.message);
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Indique o seu e-mail para receber o link de recuperação.');
      return;
    }
    if (!supabase) {
      setError('Supabase ainda não está configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
      return;
    }
    setBusy(true);
    try {
      // Sem porta hardcoded: funciona em dev e produção, com hash router.
      const redirectTo = `${window.location.origin}/#/admin/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo,
      });
      if (resetError) {
        setError('Não foi possível enviar o e-mail de recuperação. Verifique o endereço e tente novamente.');
        return;
      }
      // Resposta genérica anti-enumeração: não revela se o e-mail existe.
      setMode('forgot-sent');
      setInfo('Se existir uma conta com esse e-mail, receberá um link para definir uma nova palavra-passe.');
    } catch {
      setError('Não foi possível enviar o e-mail de recuperação. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: LoginMode) {
    setMode(next);
    setError(null);
    setInfo(null);
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

        {mode === 'login' && (
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
            {info && (
              <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-300">
                {info}
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

            <p className="mt-4 text-center">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-xs text-slate-400 underline-offset-4 hover:text-gold-300 hover:underline"
              >
                Esqueceu-se da palavra-passe?
              </button>
            </p>

            <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
              As contas de administrador são criadas pela equipa técnica (papel <code>admin</code> ou{' '}
              <code>super_admin</code> na tabela <code>profiles</code>). Não existe auto-registo público.
            </p>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotSubmit} className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-card backdrop-blur">
            <h1 className="font-display text-2xl font-bold text-white">Recuperar palavra-passe</h1>
            <p className="mt-1 text-sm text-slate-400">
              Indique o e-mail da conta de administrador. Enviaremos um link para definir uma nova palavra-passe.
            </p>

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-300">
                {info}
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

            <button
              type="submit"
              disabled={busy}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? 'A enviar…' : 'Enviar link de recuperação'}
            </button>

            <p className="mt-4 text-center">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-xs text-slate-400 underline-offset-4 hover:text-gold-300 hover:underline"
              >
                ← Voltar ao login
              </button>
            </p>
          </form>
        )}

        {mode === 'forgot-sent' && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-card backdrop-blur">
            <MailCheck className="mx-auto h-10 w-10 text-emerald-400" />
            <h1 className="mt-3 font-display text-2xl font-bold text-white">Verifique o seu e-mail</h1>
            {info && (
              <p role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-300">
                {info}
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              O link aponta para <code>/#/admin/reset-password</code> e expira em breve. Se não o vir, verifique o spam.
            </p>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110"
            >
              Voltar ao login
            </button>
          </div>
        )}

        <p className="mt-5 text-center text-xs text-slate-600">
          <Link to="/pt/" className="hover:text-gold-300">← Voltar ao sítio público</Link>
        </p>
      </div>
    </div>
  );
}
