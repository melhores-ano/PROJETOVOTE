import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, EyeOff, Medal, TrendingUp, TrendingDown, Minus, Download, SlidersHorizontal, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useSiteConfig, useCities, useCategories } from '../../hooks/useDirectory';
import { useAdminTally } from '../../hooks/useAdminVoteStats';
import type { VoteAdjustmentTarget } from '../../hooks/useVoteAdjustments';
import VoteAdjustmentModal from '../../components/VoteAdjustmentModal';
import { supabase } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { Select, Field } from '../../components/AdminForm';
import { useOptionalAdminProgram } from '../../hooks/useAdminProgram';
import { PageLoading } from '../../components/ui';
import type { Campaign } from '../../types/database';

type Trend = 'up' | 'down' | 'stable';

interface RankedRow {
  business_id: string;
  business_name: string;
  business_slug: string;
  total_votes: number;
  position: number;
  percentage: number;
  trend: Trend;
  /** FASE 4F.2: decomposição real × ajustes (fallback 0 quando a RPC pré-4F não devolve). */
  real_votes: number;
  adjustments_total: number;
}

export default function ResultsAdminPage() {
  const config = useSiteConfig();
  const citiesQuery = useCities();
  const categoriesQuery = useCategories();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [localCampaignId, setLocalCampaignId] = useState('');
  // FASE 5C.3.6 — edição selecionada no contexto Admin (única fonte).
  const adminCtx = useOptionalAdminProgram();
  const effectiveCampaigns = adminCtx ? adminCtx.campaigns : campaigns;
  const campaignId = adminCtx ? (adminCtx.selectedCampaignId ?? '') : localCampaignId;
  const setCampaignId = adminCtx
    ? (id: string) => adminCtx.setSelectedCampaign(id)
    : (id: string) => setLocalCampaignId(id);
  const [cityId, setCityId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [trends, setTrends] = useState<Record<string, Trend>>({});
  // FASE 4F.2: modal de ajuste manual + feedback sucesso/erro.
  const [adjustTarget, setAdjustTarget] = useState<VoteAdjustmentTarget | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ kind, message });
    window.setTimeout(() => {
      setToast((t) => (t?.message === message ? null : t));
    }, 6000);
  }

  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  useEffect(() => {
    (async () => {
      // FASE 5C.3.6 — com contexto, as edições vêm do programa selecionado.
      if (adminCtx) return;
      if (!supabase) return;
      const { data } = await supabase.from('campaigns').select('*').order('year', { ascending: false });
      const list = (data ?? []) as Campaign[];
      setCampaigns(list);
      if (!localCampaignId && list.length > 0) {
        const active = list.find((c) => c.status === 'votacao' || c.status === 'activa') ?? list[0];
        setLocalCampaignId(active.id);
      }
    })();
  }, [adminCtx, localCampaignId]);

  const campaign = useMemo(() => effectiveCampaigns.find((c) => c.id === campaignId) ?? null, [effectiveCampaigns, campaignId]);
  // Phase 2/3: ranking via RPC segura get_admin_tally (is_admin() server-side).
  const tally = useAdminTally(campaignId, cityId, categoryId);

  // Tendência: compara últimos 7 dias vs 7 dias anteriores por negócio (agregado, sem dados sensíveis).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTrends({});
      if (!supabase || !campaignId || !cityId || !categoryId) return;
      try {
        const since = new Date(Date.now() - 14 * 86400000).toISOString();
        const { data } = await supabase
          .from('votes')
          .select('business_id, created_at')
          .eq('campaign_id', campaignId)
          .eq('city_id', cityId)
          .eq('category_id', categoryId)
          .gte('created_at', since)
          .limit(10000);
        const week = Date.now() - 7 * 86400000;
        const recent = new Map<string, number>();
        const older = new Map<string, number>();
        for (const v of (data ?? []) as { business_id: string; created_at: string }[]) {
          const t = new Date(v.created_at).getTime();
          const map = t >= week ? recent : older;
          map.set(v.business_id, (map.get(v.business_id) ?? 0) + 1);
        }
        const out: Record<string, Trend> = {};
        for (const id of new Set([...recent.keys(), ...older.keys()])) {
          const r = recent.get(id) ?? 0;
          const o = older.get(id) ?? 0;
          out[id] = r > o ? 'up' : r < o ? 'down' : 'stable';
        }
        if (!cancelled) setTrends(out);
      } catch {
        if (!cancelled) setTrends({});
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, cityId, categoryId]);

  if (config.loading) return <PageLoading label="A carregar resultados…" />;

  // FASE 4E: autoridade de publicação pública = campaigns.results_public.
  // `results_visible` (site_settings) é interruptor legado/global e NÃO publica
  // sozinho no frontend (fail-closed). O admin vê ambos aqui para operar sem
  // ambiguidade; a página pública exige results_public=true.
  const siteVisible = config.data?.resultsVisible ?? false;
  const campaignPublic = campaign?.results_public ?? false;
  const visible = campaignPublic;
  const canQuery = Boolean(campaignId && cityId && categoryId);
  const total = (tally.data ?? []).reduce((s, r) => s + r.total_votes, 0);

  // FASE 4E: rank() local — empates partilham posição mesmo que a RPC admin
  // (row_number) ordene tecnicamente. Nunca declarar vencedor por UUID.
  // FASE 4F.2: total_votes já é o total final (GREATEST(reais + ajustes, 0))
  // vindo da RPC get_admin_tally; real_votes/adjustments_total alimentam as
  // colunas de decomposição e o modal "Ajustar votos".
  const ranked: RankedRow[] = (() => {
    const sorted = [...(tally.data ?? [])].sort(
      (a, b) => b.total_votes - a.total_votes || a.business_name.localeCompare(b.business_name, 'pt-PT'),
    );
    let rank = 0;
    let prev = -1;
    return sorted.map((r, i) => {
      if (r.total_votes !== prev) {
        rank = i + 1;
        prev = r.total_votes;
      }
      const realVotes = r.real_votes ?? r.total_votes;
      const adjustmentsTotal = r.adjustments_total ?? 0;
      return {
        ...r,
        real_votes: realVotes,
        adjustments_total: adjustmentsTotal,
        position: rank,
        percentage: total > 0 ? (r.total_votes / total) * 100 : 0,
        trend: trends[r.business_id] ?? 'stable',
      };
    });
  })();
  const firstCount = ranked.filter((r) => r.position === 1).length;
  const cityName = cities.find((c) => c.id === cityId)?.name ?? '—';
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? '—';

  function openAdjustModal(row: RankedRow) {
    if (!canQuery) return;
    setAdjustTarget({
      campaign_id: campaignId,
      city_id: cityId,
      city_name: cityName,
      category_id: categoryId,
      category_name: categoryName,
      business_id: row.business_id,
      business_name: row.business_name,
      real_votes: row.real_votes,
      adjustments_total: row.adjustments_total,
      total_votes: row.total_votes,
    });
  }

  function handleAdjustmentSuccess(message: string) {
    showToast('success', message);
    tally.refetch();
  }

  async function exportCsv() {
    if (!canQuery || ranked.length === 0) return;
    const city = cities.find((c) => c.id === cityId);
    const cat = categories.find((c) => c.id === categoryId);
    // Exportação agregada e segura: sem ip_hash, device_hash ou dados de segurança.
    // FASE 4F.2: inclui decomposição reais × ajustes × total final.
    const header = 'posicao;negocio;cidade;categoria;edicao;votos_reais;ajustes;total_final;percentagem';
    const lines = ranked.map((r) => [
      r.position,
      `"${r.business_name.replace(/"/g, '""')}"`,
      `"${(city?.name ?? '').replace(/"/g, '""')}"`,
      `"${(cat?.name ?? '').replace(/"/g, '""')}"`,
      campaign?.year ?? '',
      r.real_votes,
      r.adjustments_total,
      r.total_votes,
      r.percentage.toFixed(1).replace('.', ','),
    ].join(';'));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resultados-${campaign?.year ?? 'edicao'}-${city?.slug ?? 'cidade'}-${cat?.slug ?? 'categoria'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await audit('results.export', 'campaigns', campaignId, {
      city_id: cityId, category_id: categoryId, rows: ranked.length, total_votes: total,
    });
  }

  const TrendIcon = ({ t }: { t: Trend }) =>
    t === 'up' ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : t === 'down' ? <TrendingDown className="h-3.5 w-3.5 text-red-400" /> : <Minus className="h-3.5 w-3.5 text-slate-500" />;

  return (
    <div>
      <AdminHeader title="Resultados" description="Apuramento interno por edição × cidade × categoria, com percentagens, tendência e exportação agregada segura." />
      <SupabaseNotice />

      {/* FASE 4F.2: feedback imediato sucesso/erro dos ajustes. */}
      {toast && (
        <div
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={`mb-4 flex items-start gap-3 rounded-2xl border p-4 text-[13px] leading-relaxed ${
            toast.kind === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          )}
          <p className="min-w-0 flex-1">{toast.message}</p>
          <button
            onClick={() => setToast(null)}
            aria-label="Fechar mensagem"
            className="rounded-lg p-1 text-current opacity-70 transition hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <AdminCard title="Visibilidade actual">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5">
            {visible ? <Trophy className="h-5 w-5 text-gold-400" /> : <EyeOff className="h-5 w-5 text-slate-400" />}
          </span>
          <div className="text-sm">
            <p className="font-semibold text-white">{visible ? 'Resultados públicos' : 'Resultados privados'}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
              Edição: <strong className="text-slate-200">{campaign?.name ?? '—'}</strong> · autoridade:{' '}
              <strong className="text-slate-200">campaigns.results_public = {campaignPublic ? 'true' : 'false'}</strong>
              {' '}· interruptor global legado: results_visible = {siteVisible ? 'true' : 'false'} (não publica sozinho).
              Altere em{' '}
              <Link to="/admin/configuracoes" className="text-gold-300 underline">Configurações</Link> ou{' '}
              <Link to="/admin/campanhas" className="text-gold-300 underline">Campanhas</Link> (com auditoria e confirmação).
            </p>
            {ranked.length > 0 && firstCount > 1 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                <Medal className="h-3.5 w-3.5" /> Empate no 1.º lugar ({firstCount} empatados) — sem vencedor exclusivo.
              </p>
            )}
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Apuramento por edição × cidade × categoria" className="mt-4">
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="Edição">
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="" className="bg-navy-900">— Escolher edição —</option>
              {effectiveCampaigns.map((c) => (
                <option key={c.id} value={c.id} className="bg-navy-900">{c.year} · {c.status}</option>
              ))}
            </Select>
          </Field>
          <Field label="Cidade">
            <Select value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="" className="bg-navy-900">— Escolher cidade —</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Categoria">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="" className="bg-navy-900">— Escolher categoria —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        {!canQuery ? (
          <p className="rounded-xl border border-dashed border-white/15 py-8 text-center text-sm text-slate-500">
            Escolha uma edição, cidade e categoria para ver o apuramento.
          </p>
        ) : tally.loading ? (
          <PageLoading label="A apurar votos…" />
        ) : tally.error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[13px] leading-relaxed"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-red-200">Não foi possível carregar o apuramento.</p>
              <p className="mt-1 break-words font-mono text-xs text-red-300/90">{tally.error}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">{ranked.length} negócios · {total} votos no total · {cityName} · {categoryName}</p>
            <AdminTable<RankedRow>
              rows={ranked}
              searchable
              searchKeys={['business_name']}
              searchPlaceholder="Pesquisar empresa…"
              emptyMessage="Sem votos apurados para esta combinação. A contagem preencher-se-á à medida que a votação decorre."
              columns={[
                {
                  key: 'position', label: 'Posição',
                  render: (r) => (
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      {r.position === 1 && <Medal className="h-4 w-4 text-gold-400" />}
                      {r.position}.º
                    </span>
                  ),
                },
                {
                  key: 'business_name', label: 'Empresa',
                  render: (r) => (
                    <span className="font-medium text-white">{r.business_name}</span>
                  ),
                },
                { key: 'city', label: 'Cidade', render: () => <span className="text-slate-300">{cityName}</span> },
                { key: 'category', label: 'Categoria', render: () => <span className="text-slate-300">{categoryName}</span> },
                {
                  key: 'real_votes', label: 'Votos reais',
                  render: (r) => <span className="font-semibold text-slate-100">{r.real_votes}</span>,
                },
                {
                  key: 'adjustments_total', label: 'Ajustes',
                  render: (r) => (
                    <span className={`font-semibold ${r.adjustments_total < 0 ? 'text-red-300' : r.adjustments_total > 0 ? 'text-emerald-300' : 'text-slate-400'}`}>
                      {r.adjustments_total > 0 ? `+${r.adjustments_total}` : r.adjustments_total}
                    </span>
                  ),
                },
                { key: 'total_votes', label: 'Total final', render: (r) => <strong className="text-gold-300">{r.total_votes}</strong> },
                {
                  key: 'percentage', label: '%',
                  render: (r) => (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden>
                        <span className="block h-full rounded-full bg-gold-gradient" style={{ width: `${Math.max(2, Math.min(100, r.percentage))}%` }} />
                      </span>
                      {r.percentage.toFixed(1).replace('.', ',')}%
                    </span>
                  ),
                },
                {
                  key: 'trend', label: 'Tendência',
                  render: (r) => (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400" title="Últimos 7 dias vs 7 dias anteriores">
                      <TrendIcon t={r.trend} />
                      {r.trend === 'up' ? 'A subir' : r.trend === 'down' ? 'A descer' : 'Estável'}
                    </span>
                  ),
                },
                {
                  key: 'actions', label: 'Ajuste',
                  render: (r) => (
                    <button
                      onClick={() => openAdjustModal(r)}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-semibold text-gold-200 transition hover:bg-gold-500/20 active:scale-[0.98]"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Ajustar votos
                    </button>
                  ),
                },
              ]}
            />
            {ranked.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={exportCsv}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300"
                >
                  <Download className="h-4 w-4" /> Exportar CSV (agregado)
                </button>
                <span className="text-[11px] text-slate-500">A exportação inclui apenas totais agregados — sem IP, hashes de dispositivo ou dados de segurança.</span>
              </div>
            )}
          </>
        )}
      </AdminCard>

      {/* FASE 4F.2: modal de ajuste manual (INSERT em vote_adjustments, infra 0010). */}
      {adjustTarget && (
        <VoteAdjustmentModal
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSuccess={handleAdjustmentSuccess}
        />
      )}
    </div>
  );
}
