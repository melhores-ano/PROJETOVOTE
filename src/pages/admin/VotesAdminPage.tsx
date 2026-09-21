import { useState } from 'react';
import { Ban, CalendarDays, MapPin, Shapes, ShieldAlert, TrendingUp, Vote } from 'lucide-react';
import { useVoteAttempts, isLive } from '../../hooks/useAdminData';
import {
  useAdminVoteOverview,
  useAdminVoteTimeline,
} from '../../hooks/useAdminVoteStats';
import { useActiveCampaign } from '../../hooks/useDirectory';
import { useOptionalAdminProgram } from '../../hooks/useAdminProgram';
import type { VoteAttemptOutcome } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { Select } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

const OUTCOMES: { value: VoteAttemptOutcome | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos os resultados' },
  { value: 'aceite', label: 'Aceites' },
  { value: 'duplicado', label: 'Duplicados' },
  { value: 'bloqueado', label: 'Bloqueados' },
  { value: 'invalido', label: 'Inválidos' },
  { value: 'rate_limit', label: 'Rate limit' },
];

const outcomeTone: Record<VoteAttemptOutcome, string> = {
  aceite: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  duplicado: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  bloqueado: 'border-red-500/30 bg-red-500/10 text-red-300',
  invalido: 'border-white/15 bg-white/5 text-slate-400',
  rate_limit: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
};

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Barra horizontal simples (sem dependências) para rankings. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-28 overflow-hidden rounded-full bg-white/10 sm:w-40" aria-hidden>
      <div className="h-full rounded-full bg-gold-gradient" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function VotesAdminPage() {
  const [outcome, setOutcome] = useState<VoteAttemptOutcome | 'all'>('all');
  const activeCampaign = useActiveCampaign();
  // FASE 5C.3.6 — métricas da EDIÇÃO SELECIONADA no contexto Admin.
  // Fallback (sem provider): edição ativa pública.
  const adminCtx = useOptionalAdminProgram();
  const campaignId = adminCtx
    ? (adminCtx.selectedCampaignId ?? undefined)
    : activeCampaign.data?.id;
  const editionLabel = adminCtx?.selectedCampaign
    ? `Edição ${adminCtx.selectedCampaign.year} — ${adminCtx.selectedCampaign.name}`
    : 'edição activa';
  const overview = useAdminVoteOverview(campaignId);
  const timeline = useAdminVoteTimeline(campaignId, 14);
  const attempts = useVoteAttempts(outcome);

  const ov = overview.data;
  const maxCity = Math.max(0, ...(ov?.by_city.map((c) => c.total_votes) ?? [0]));
  const maxCat = Math.max(0, ...(ov?.by_category.map((c) => c.total_votes) ?? [0]));
  const maxDay = Math.max(1, ...(timeline.data ?? []).map((d) => d.total_votes));

  return (
    <div>
      <AdminHeader
        title="Votos"
        description={`Motor de votação Phase 2 (${editionLabel}): totais, evolução, repartição por cidade/categoria e eventos antifraude (inserção pública directa bloqueada pelo RLS).`}
      />
      <SupabaseNotice />

      {!activeCampaign.loading && !overview.loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminCard>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10">
                <Vote className="h-5 w-5 text-gold-400" />
              </span>
              <div>
                <p className="font-display text-2xl font-bold text-white">{ov?.total_votes ?? 0}</p>
                <p className="text-xs text-slate-400">Total de votos (edição activa)</p>
              </div>
            </div>
          </AdminCard>
          <AdminCard>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                <CalendarDays className="h-5 w-5 text-emerald-300" />
              </span>
              <div>
                <p className="font-display text-2xl font-bold text-white">{ov?.votes_today ?? 0}</p>
                <p className="text-xs text-slate-400">Votos hoje · 7d: {ov?.votes_last_7d ?? 0}</p>
              </div>
            </div>
          </AdminCard>
          <AdminCard>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5">
                <ShieldAlert className="h-5 w-5 text-slate-300" />
              </span>
              <div>
                <p className="font-display text-2xl font-bold text-white">{attempts.loading ? '…' : attempts.data.length}</p>
                <p className="text-xs text-slate-400">Eventos listados (filtro actual)</p>
              </div>
            </div>
          </AdminCard>
          <AdminCard>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
                <Ban className="h-5 w-5 text-amber-400" />
              </span>
              <p className="text-[13px] leading-relaxed text-slate-400">
                Votação via Edge Function <code>cast-vote</code>. INSERT directo em <code>votes</code> bloqueado.
              </p>
            </div>
          </AdminCard>
        </div>
      )}

      {/* Linha temporal */}
      <AdminCard title="Evolução — últimos 14 dias" className="mt-4">
        {timeline.loading ? (
          <PageLoading label="A carregar evolução…" />
        ) : (timeline.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            {isLive
              ? 'Sem votos na edição activa. A curva preencher-se-á com a votação.'
              : 'Modo de demonstração: ligue o Supabase para ver a evolução real.'}
          </p>
        ) : (
          <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Evolução diária de votos">
            {(timeline.data ?? []).map((d) => (
              <div key={d.day} className="group flex flex-1 flex-col items-center gap-1.5" title={`${d.day}: ${d.total_votes} votos`}>
                <span className="text-[11px] font-semibold text-gold-300 opacity-0 transition group-hover:opacity-100">
                  {d.total_votes}
                </span>
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-gold-700/60 to-gold-300 transition group-hover:brightness-125"
                  style={{ height: `${Math.max(4, Math.round((d.total_votes / maxDay) * 100))}%` }}
                />
                <span className="text-[10px] text-slate-500">{formatDay(d.day)}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Repartições */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Votos por cidade">
          {(ov?.by_city ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Sem repartição por cidade.</p>
          ) : (
            <ul className="space-y-3">
              {(ov?.by_city ?? []).slice(0, 8).map((c) => (
                <li key={c.city_id} className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 shrink-0 text-gold-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{c.city_name}</span>
                  <Bar value={c.total_votes} max={maxCity} />
                  <strong className="w-12 text-right text-sm text-gold-300">{c.total_votes}</strong>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
        <AdminCard title="Votos por categoria">
          {(ov?.by_category ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Sem repartição por categoria.</p>
          ) : (
            <ul className="space-y-3">
              {(ov?.by_category ?? []).slice(0, 8).map((c) => (
                <li key={c.category_id} className="flex items-center gap-3">
                  <Shapes className="h-4 w-4 shrink-0 text-gold-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{c.category_name}</span>
                  <Bar value={c.total_votes} max={maxCat} />
                  <strong className="w-12 text-right text-sm text-gold-300">{c.total_votes}</strong>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      {(ov?.attempts_by_outcome ?? []).length > 0 && (
        <AdminCard title="Antifraude — últimos 30 dias" className="mt-4">
          <div className="flex flex-wrap gap-2">
            {(ov?.attempts_by_outcome ?? []).map((a) => (
              <span
                key={a.outcome}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${outcomeTone[a.outcome as VoteAttemptOutcome] ?? outcomeTone.invalido}`}
              >
                <TrendingUp className="h-3.5 w-3.5" /> {a.outcome}: {a.total}
              </span>
            ))}
          </div>
        </AdminCard>
      )}

      <AdminCard
        title={`Eventos de segurança (${attempts.data.length})`}
        className="mt-4"
      >
        <div className="mb-4 max-w-xs">
          <Select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as VoteAttemptOutcome | 'all')}
            aria-label="Filtrar por resultado"
          >
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value} className="bg-navy-900">{o.label}</option>
            ))}
          </Select>
        </div>
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
            emptyMessage={
              isLive
                ? 'Sem eventos registados para este filtro.'
                : 'Modo de demonstração: sem Supabase não existem eventos.'
            }
            columns={[
              { key: 'created_at', label: 'Data/hora', render: (r) => <span className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(r.created_at)}</span> },
              {
                key: 'outcome', label: 'Resultado',
                render: (r) => (
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${outcomeTone[r.outcome]}`}>
                    {r.outcome}
                  </span>
                ),
              },
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
