import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, LockKeyhole, ShieldAlert } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { BrandLogo } from '../../components/BrandLogo';
import { brand } from '../../config/brand';

type PageState = 'checking' | 'ready' | 'success' | 'expired';

function isPasswordStrong(password: string): { ok: boolean; hints: string[] } {
  const hints: string[] = [];
  if (password.length < 8) hints.push('Mínimo de 8 caracteres.');
  if (!/[A-Za-zÀ-ÿ]/.test(password)) hints.push('Incluir pelo menos uma letra.');
  if (!/[0-9]/.test(password)) hints.push('Incluir pelo menos um número.');
  return { ok: hints.length === 0, hints };
}

/**
 * CORREÇÃO PONTUAL — Recuperação de palavra-passe Admin.
 * Rota pública: /admin/reset-password (hash: /#/admin/reset-password).
 * Não altera profiles/RLS, não cria utilizadores, não altera roles.
 * Usa apenas o client Supabase Auth existente (anon key).
 */
export default function AdminResetPasswordPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('checking');
  const [recoveryDetected, setRecoveryDetected] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkRecoverySession() {
      if (!supabase) {
        if (!cancelled) setState('expired');
        return;
      }
      try {
        // O cliente Supabase detecta automaticamente a sessão de recuperação
        // a partir do fragmento do URL (detectSessionInUrl).
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!cancelled) {
          if (sessionError) {
            setState('expired');
            return;
          }
          if (data.session) {
            setRecoveryDetected(true);
            setState('ready');
          } else {
            // Aguarda brevemente o evento PASSWORD_RECOVERY; se não chegar,
            // considera o link inválido/expirado.
            setTimeout(() => {
              if (!cancelled) {
                setState((prev) => (prev === 'checking' ? 'expired' : prev));
              }
            }, 2500);
          }
        }
      } catch {
        if (!cancelled) setState('expired');
      }
    }

    void checkRecoverySession();

    if (!supabase) return undefined;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        setRecoveryDetected(true);
        setState('ready');
      } else if (event === 'SIGNED_IN' && session && !recoveryDetected) {
        // Sessão válida vinda do link de recuperação também habilita o formulário.
        setRecoveryDetected(true);
        setState((prev) => (prev === 'checking' ? 'ready' : prev));
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [recoveryDetected]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!supabase) {
        setError('Supabase ainda não está configurado.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('As palavras-passe não coincidem.');
        return;
      }
      const strength = isPasswordStrong(newPassword);
      if (!strength.ok) {
        setError(`Palavra-passe fraca. ${strength.hints.join(' ')}`);
        return;
      }

      setBusy(true);
      try {
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (updateError) {
          // Nunca expor tokens; mensagem genérica e segura.
          if (updateError.message.toLowerCase().includes('expired') || updateError.message.toLowerCase().includes('invalid')) {
            setState('expired');
            setError('O link de recuperação expirou ou é inválido. Peça um novo link em /admin/login.');
          } else {
            setError('Não foi possível definir a nova palavra-passe. Tente novamente ou peça um novo link.');
          }
          return;
        }
        // Segurança: terminar a sessão de recuperação após a troca.
        await supabase.auth.signOut();
        setState('success');
      } catch {
        setError('Não foi possível definir a nova palavra-passe. Tente novamente.');
      } finally {
        setBusy(false);
      }
    },
    [newPassword, confirmPassword],
  );

  const strength = isPasswordStrong(newPassword);
  const matches = newPassword.length > 0 && newPassword === confirmPassword;

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

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-card backdrop-blur">
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
            <LockKeyhole className="h-6 w-6 text-gold-400" />
            Definir nova palavra-passe
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Introduza a nova palavra-passe da sua conta de administrador.
          </p>

          {!isSupabaseConfigured && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Supabase por configurar — a recuperação ficará disponível após definir as variáveis de ambiente.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
              {error}
            </p>
          )}

          {state === 'checking' && (
            <p className="mt-6 flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              A verificar link de recuperação…
            </p>
          )}

          {state === 'expired' && (
            <div className="mt-6">
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] leading-relaxed text-amber-200">
                O link de recuperação é inválido ou expirou. Por segurança, os links têm validade limitada.
              </p>
              <button
                type="button"
                onClick={() => navigate('/admin/login', { replace: true })}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110"
              >
                Pedir novo link em /admin/login
              </button>
            </div>
          )}

          {state === 'ready' && (
            <form onSubmit={handleSubmit} className="mt-5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Nova palavra-passe
                </span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres, letra + número"
                  className="w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
                />
              </label>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Confirmar nova palavra-passe
                </span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a nova palavra-passe"
                  className="w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
                />
              </label>

              <ul className="mt-3 space-y-1 text-xs" aria-live="polite">
                <li className={newPassword.length >= 8 ? 'text-emerald-300' : 'text-slate-500'}>
                  {newPassword.length >= 8 ? '✓' : '•'} Mínimo de 8 caracteres
                </li>
                <li className={/[A-Za-zÀ-ÿ]/.test(newPassword) ? 'text-emerald-300' : 'text-slate-500'}>
                  {/[A-Za-zÀ-ÿ]/.test(newPassword) ? '✓' : '•'} Pelo menos uma letra
                </li>
                <li className={/[0-9]/.test(newPassword) ? 'text-emerald-300' : 'text-slate-500'}>
                  {/[0-9]/.test(newPassword) ? '✓' : '•'} Pelo menos um número
                </li>
                <li className={matches ? 'text-emerald-300' : 'text-slate-500'}>
                  {matches ? '✓' : '•'} As palavras-passe coincidem
                </li>
              </ul>

              <button
                type="submit"
                disabled={busy || !strength.ok || !matches}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'A guardar…' : 'Guardar nova palavra-passe'}
              </button>
            </form>
          )}

          {state === 'success' && (
            <div className="mt-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <p className="mt-3 text-sm font-semibold text-white">Palavra-passe atualizada com sucesso.</p>
              <p className="mt-1 text-xs text-slate-400">
                Já pode iniciar sessão com a nova palavra-passe.
              </p>
              <button
                type="button"
                onClick={() => navigate('/admin/login', { replace: true })}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110"
              >
                Ir para /admin/login
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-slate-600">
          <Link to="/admin/login" className="hover:text-gold-300">← Voltar ao login</Link>
        </p>
      </div>
    </div>
  );
}
