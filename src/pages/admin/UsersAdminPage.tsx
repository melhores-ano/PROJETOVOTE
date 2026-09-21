import { useState } from 'react';
import { ShieldAlert, Crown } from 'lucide-react';
import { useProfiles, isLive } from '../../hooks/useAdminData';
import { useAuth } from '../../hooks/AuthContext';
import { supabase } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import type { AdminRole, Profile } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { Select, FormError } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

/**
 * Gestão de administradores — exclusiva de super_admin
 * (policy RLS `super_admin manage profiles`). Sem auto-registo:
 * as contas são criadas pela equipa técnica em Supabase Auth + profiles.
 */
export default function UsersAdminPage() {
  const query = useProfiles();
  const { userId } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function changeRole(profile: Profile, role: AdminRole) {
    setError(null);
    if (!supabase) return;
    if (profile.id === userId && role !== 'super_admin') {
      setError('Não pode remover o seu próprio papel de super administrador (protecção contra bloqueio).');
      return;
    }
    setSavingId(profile.id);
    try {
      const { error: upError } = await supabase.from('profiles').update({ role }).eq('id', profile.id);
      if (upError) throw upError;
      await audit('profile.role_change', 'profiles', profile.id, { email: profile.email, role });
      query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao actualizar o papel.');
    } finally {
      setSavingId(null);
    }
  }

  if (query.loading) return <PageLoading label="A carregar utilizadores…" />;

  return (
    <div>
      <AdminHeader
        title="Utilizadores"
        description="Administradores da plataforma. Apenas super administradores podem gerir papéis."
      />
      <SupabaseNotice />
      <AdminCard title={`Administradores (${query.data.length})`}>
        <FormError message={error} />
        {query.error && query.data.length === 0 ? (
          <ErrorState message={query.error} onRetry={query.refetch} />
        ) : (
          <>
            <AdminTable<Profile>
              searchable
              searchKeys={['email', 'display_name', 'role']}
              searchPlaceholder="Pesquisar utilizadores…"
              rows={query.data}
              emptyMessage={
                isLive
                  ? 'Sem perfis. Crie o primeiro super administrador via SQL (ver relatório da Fase 1).'
                  : 'Modo de demonstração: ligue o Supabase para gerir os administradores reais.'
              }
              columns={[
                {
                  key: 'email', label: 'Email',
                  render: (r) => (
                    <span className="flex items-center gap-2 font-medium text-white">
                      {r.role === 'super_admin' && <Crown className="h-4 w-4 shrink-0 text-gold-400" />}
                      {r.email}
                      {r.id === userId && (
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">si</span>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'display_name', label: 'Nome',
                  render: (r) => r.display_name ?? '—',
                },
                {
                  key: 'role', label: 'Papel',
                  render: (r) => (
                    <Select
                      value={r.role}
                      disabled={savingId === r.id || !isLive}
                      onChange={(e) => changeRole(r, e.target.value as AdminRole)}
                      aria-label={`Papel de ${r.email}`}
                      className="!w-auto !py-1.5 text-xs"
                    >
                      <option value="admin" className="bg-navy-900">admin</option>
                      <option value="super_admin" className="bg-navy-900">super_admin</option>
                    </Select>
                  ),
                },
                {
                  key: 'created_at', label: 'Desde',
                  render: (r) => {
                    try {
                      return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(r.created_at));
                    } catch {
                      return '—';
                    }
                  },
                },
              ]}
            />
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Novos administradores: 1) criar o utilizador em Supabase Auth, 2) inserir a linha em{' '}
              <code>profiles</code> com o papel pretendido. Nunca exponha este fluxo ao público.
            </p>
          </>
        )}
      </AdminCard>
    </div>
  );
}
