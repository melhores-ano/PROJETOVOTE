import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { AdminRole, Profile } from '../types/database';

interface AuthContextValue {
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  role: AdminRole | null;
  isAdmin: boolean;
  loading: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadProfile = useCallback(async (uid: string): Promise<Profile | null> => {
    if (!supabase) return null;
    try {
      const query = supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('profile-timeout')), 6000),
      );
      const { data, error } = await Promise.race([query, timeout]);
      if (error) {
        setAuthError('Não foi possível carregar o perfil de administrador.');
        return null;
      }
      return (data as Profile) ?? null;
    } catch {
      setAuthError('Não foi possível carregar o perfil de administrador.');
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      try {
        // Nunca bloquear o arranque: sessão local com timeout de 6s.
        const sessionPromise = supabase.auth.getSession();
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('auth-timeout')), 6000),
        );
        const { data } = await Promise.race([sessionPromise, timeout]);
        const session = data.session;
        if (!session?.user) {
          if (!cancelled) setLoading(false);
          return;
        }
        const p = await loadProfile(session.user.id);
        if (!cancelled) {
          setUserId(session.user.id);
          setEmail(session.user.email ?? null);
          setProfile(p);
          setLoading(false);
        }
      } catch (err) {
        console.warn('[auth] init com fallback (sem sessão):', err);
        if (!cancelled) setLoading(false);
      }
    }
    init();

    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setUserId(null);
        setEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const p = await loadProfile(session.user.id);
      if (!cancelled) {
        setUserId(session.user.id);
        setEmail(session.user.email ?? null);
        setProfile(p);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (emailInput: string, password: string) => {
    setAuthError(null);
    if (!supabase) {
      return { ok: false, message: 'Supabase ainda não está configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.' };
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.trim(),
      password,
    });
    if (error || !data.user) {
      const message = 'Credenciais inválidas. Verifique o email e a palavra-passe.';
      setAuthError(message);
      return { ok: false, message };
    }
    const p = await loadProfile(data.user.id);
    if (!p) {
      await supabase.auth.signOut();
      const message = 'Esta conta não tem permissões de administração.';
      setAuthError(message);
      return { ok: false, message };
    }
    setUserId(data.user.id);
    setEmail(data.user.email ?? null);
    setProfile(p);
    return { ok: true, message: 'Sessão iniciada com sucesso.' };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setUserId(null);
    setEmail(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    userId,
    email,
    profile,
    role: profile?.role ?? null,
    isAdmin: profile?.role === 'admin' || profile?.role === 'super_admin',
    loading,
    authError,
    signIn,
    signOut,
  }), [userId, email, profile, loading, authError, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser utilizado dentro de <AuthProvider>.');
  return ctx;
}
