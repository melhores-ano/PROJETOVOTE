import { useMemo } from 'react';
import { ShieldCheck, Lock, KeyRound, Copy, Gauge, Bot, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useVoteAttempts, isLive } from '../../hooks/useAdminData';
import { useAdminVoteOverview } from '../../hooks/useAdminVoteStats';
import { useActiveCampaign } from '../../hooks/useDirectory';
import { useOptionalAdminProgram } from '../../hooks/useAdminProgram';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { PageLoading, ErrorState } from '../../components/ui';

const POLICIES = [
  { table: 'cities, categories, businesses, campaign_entries', rule: 'Leitura pública apenas de registos activos (anon + authenticated).' },
  { table: 'campaigns, site_settings, sponsors', rule: 'Leitura pública; escrita exclusiva de admins (is_admin()).' },
  { table: 'votes', rule: 'Fase 2: SEM policies de INSERT/UPDATE/DELETE para anon/authenticated — RLS nega por omissão. Escrita só via Edge Function cast-vote (service_role). Leitura só admins. UNIQUE (campaign, city, category, ip_hash) como barreira anti-race.' },
  { table: 'vote_attempts', rule: 'Escrita só via Edge Function; leitura só admins. Nunca exposta publicamente. Guarda apenas hashes (ip_hash, device_hash) — nenhum IP em claro é persistido.' },
  { table: 'RPCs admin: get_admin_vote_overview / get_admin_tally / get_admin_vote_timeline', rule: 'SECURITY DEFINER com verificação is_admin() interna; revoke public + grant authenticated. Negam não-admins com 42501.' },
  { table: 'RPC pública: get_published_results (0003 → 0009 Fase 4E)', rule: 'Só agrega edições com results_public=true (fail-closed). Ranking com rank() — empates partilham posição (1.º, 1.º, 3.º), sem vencedor exclusivo inventado. Só participantes válidos (campaign_entries active). Nenhum voto individual, hash ou dado antifraude exposto.' },
  { table: 'profiles', rule: 'Cada utilizador lê o próprio perfil; gestão exclusiva de super_admin. Sem auto-atribuição.' },
  { table: 'audit_logs', rule: 'Leitura + INSERT admin; UPDATE/DELETE bloqueados por trigger audit_no_update (imutável ao nível da BD, inclusive service_role).' },
  { table: 'storage.objects (4 buckets)', rule: 'Leitura pública; upload/update/delete apenas por admins.' },
];

function outcomeTotal(list: { outcome: string; total: number }[] | undefined, key: string): number {
  return list?.find((o) => o.outcome === key)?.total ?? 0;
}

export default function SecurityAdminPage() {
  const activeCampaign = useActiveCampaign();
  // FASE 5C.3.6 — antifraude da EDIÇÃO SELECIONADA no contexto Admin.
  const adminCtx = useOptionalAdminProgram();
  const campaignId = adminCtx
    ? adminCtx.selectedCampaignId ?? undefined
    : activeCampaign.data?.id;
  const overview = useAdminVoteOverview(campaignId);
  const attempts = useVoteAttempts('all', 500);

  const byOutcome = overview.data?.attempts_by_outcome;
  const duplicates = outcomeTotal(byOutcome, 'duplicado');
  const rateLimited = outcomeTotal(byOutcome, 'rate_limit');
  const blocked = outcomeTotal(byOutcome, 'bloqueado');
  const invalid = outcomeTotal(byOutcome, 'invalido');

  // CAPTCHA: motivos agregados (sem expor hashes) — conta tentativas cujo motivo indica captcha.
  const captchaFails = useMemo(
    () => attempts.data.filter((a) => /captcha|turnstile/i.test(a.reason ?? '')).length,
    [attempts.data],
  );

  // Rajadas suspeitas: horas com volume anómalo (agregado por hora, sem IPs).
  const bursts = useMemo(() => {
    const perHour = new Map<string, number>();
    for (const a of attempts.data) {
      try {
        const d = new Date(a.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
        perHour.set(key, (perHour.get(key) ?? 0) + 1);
      } catch { /* ignora datas inválidas */ }
    }
    const values = [...perHour.values()];
    if (values.length === 0) return [];
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const threshold = Math.max(20, avg * 3);
    return [...perHour.entries()]
      .filter(([, v]) => v >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [attempts.data]);

  return (
    <div>
      <AdminHeader title="Segurança" description="Monitorização antifraude com agregados seguros para a privacidade: sem IP em claro, sem hashes expostos." />
      <SupabaseNotice />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Copy, label: 'Tentativas duplicadas', value: overview.loading ? '…' : String(duplicates), hint: 'outcome = duplicado · 30 dias' },
          { icon: Gauge, label: 'Pedidos com rate-limit', value: overview.loading ? '…' : String(rateLimited), hint: 'outcome = rate_limit · 30 dias' },
          { icon: Bot, label: 'Falhas de CAPTCHA', value: attempts.loading ? '…' : String(captchaFails), hint: 'motivo indica Turnstile/CAPTCHA' },
          { icon: Zap, label: 'Rajadas suspeitas', value: attempts.loading ? '…' : String(bursts.length), hint: 'horas com volume anómalo' },
        ].map((c) => (
          <AdminCard key={c.label}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5">
                <c.icon className="h-5 w-5 text-gold-400" />
              </span>
              <div>
                <p className="font-display text-2xl font-bold text-white">{c.value}</p>
                <p className="text-xs font-medium text-slate-300">{c.label}</p>
                <p className="text-[11px] text-slate-500">{c.hint}</p>
              </div>
            </div>
          </AdminCard>
        ))}
      </div>

      {(bursts.length > 0 || blocked > 0 || invalid > 0) && (
        <AdminCard title="Sinais a acompanhar" className="mt-4">
          <ul className="space-y-2 text-[13px] text-slate-300">
            {bursts.map(([hour, count]) => (
              <li key={hour} className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2.5">
                <span>Rajada suspeita — volume anómalo agregado em <strong>{hour}</strong> (sem identificação de votantes).</span>
                <strong className="text-amber-300">{count} eventos</strong>
              </li>
            ))}
            {blocked > 0 && <li className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-2.5">{blocked} tentativas bloqueadas nos últimos 30 dias (motivos antifraude, sem dados pessoais).</li>}
            {invalid > 0 && <li className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-2.5">{invalid} tentativas inválidas (parâmetros ou estado de campanha).</li>}
          </ul>
        </AdminCard>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {[
          { icon: ShieldCheck, title: 'Row Level Security', text: 'Activo em todas as tabelas. O frontend nunca é a única barreira — a BD impõe as regras.' },
          { icon: Lock, title: 'Sem IP em claro', text: 'Votes e tentativas guardam apenas hashes (ip_hash, device_hash). Nenhum endereço bruto é persistido nem exibido.' },
          { icon: KeyRound, title: 'Sem service_role no cliente', text: 'O browser usa apenas a anon key. Operações sensíveis ficam reservadas a Edge Functions.' },
        ].map((c) => (
          <AdminCard key={c.title}>
            <c.icon className="h-6 w-6 text-gold-400" />
            <h2 className="mt-3 font-semibold text-white">{c.title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{c.text}</p>
          </AdminCard>
        ))}
      </div>

      <AdminCard title="Matriz de policies RLS (migrações 0001 + 0003 + 0005 + 0006 + 0009)" className="mt-4">
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="bg-navy-900/70 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Tabela(s)</th>
                <th className="px-4 py-3">Regra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {POLICIES.map((p) => (
                <tr key={p.table} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3"><code className="text-xs text-gold-300">{p.table}</code></td>
                  <td className="px-4 py-3 text-[13px] text-slate-300">{p.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminCard>

      <AdminCard title={`Eventos de segurança — últimos ${attempts.data.length} (agregados, sem IP)`} className="mt-4">
        <p className="mb-4 text-[13px] leading-relaxed text-slate-400">
          Tabela <code>vote_attempts</code>: apenas resultado, motivo, hora e nomes de edição/cidade/categoria/negócio.
          Nunca são apresentados endereços IP, hashes de IP/dispositivo ou user-agents.{' '}
          <Link to="/admin/auditoria" className="text-gold-300 underline">Ver auditoria administrativa</Link>
        </p>
        {attempts.loading ? (
          <PageLoading label="A carregar eventos…" />
        ) : attempts.error ? (
          <ErrorState message={attempts.error} onRetry={attempts.refetch} />
        ) : (
          <AdminTable
            searchable
            searchKeys={['business', 'city', 'category', 'reason', 'outcome']}
            searchPlaceholder="Pesquisar eventos…"
            rows={attempts.data}
            emptyMessage={isLive ? 'Sem eventos registados.' : 'Modo de demonstração: sem Supabase não existem eventos.'}
            columns={[
              { key: 'created_at', label: 'Data/hora', render: (r) => {
                let label = String(r.created_at);
                try { label = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(String(r.created_at))); } catch { /* bruto */ }
                return <span className="whitespace-nowrap text-xs text-slate-400">{label}</span>;
              } },
              { key: 'outcome', label: 'Resultado', render: (r) => <code className="text-xs text-gold-300">{String(r.outcome)}</code> },
              { key: 'business', label: 'Negócio', render: (r) => r.business ?? '—' },
              { key: 'city', label: 'Cidade', render: (r) => r.city ?? '—' },
              { key: 'category', label: 'Categoria', render: (r) => r.category ?? '—' },
              { key: 'reason', label: 'Motivo', render: (r) => <span className="text-xs text-slate-500">{r.reason ?? '—'}</span> },
            ]}
          />
        )}
      </AdminCard>
    </div>
  );
}
