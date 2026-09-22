import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, EyeOff, Medal, TrendingUp, TrendingDown, Minus, Download, SlidersHorizontal, CheckCircle2, AlertTriangle, X, Sparkles, BadgeCheck } from 'lucide-react';
import { useSiteConfig, useCities, useCategories } from '../../hooks/useDirectory';
import { useAdminTally } from '../../hooks/useAdminVoteStats';
import { useScopedModalities } from '../../hooks/useAdminData';
import { useAdminModalityTally } from '../../hooks/useAdminModalityTally';
import { createDistinction } from '../../lib/distinctions';
import type { VoteAdjustmentTarget } from '../../hooks/useVoteAdjustments';
import VoteAdjustmentModal from '../../components/VoteAdjustmentModal';
import { supabase } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { Select, Field, Modal, FormError } from '../../components/AdminForm';
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
  // FASE 5C.3.9 — modalidade selecionada para o apuramento de destaques.
  // Leitura EXCLUSIVA via get_admin_modality_tally (modality_votes); o
  // resultado principal (get_admin_tally) permanece completamente separado.
  const [modalityId, setModalityId] = useState('');
  // FASE 4F.2: modal de ajuste manual + feedback sucesso/erro.
  const [adjustTarget, setAdjustTarget] = useState<VoteAdjustmentTarget | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  // FASE 5C.3.10 — criar distinção a partir do resultado de modalidade.
  // Origem default: modality_vote. award_status inicial = selected,
  // commercial_status inicial = pending. Nunca copia votos; nunca altera
  // votes / vote_attempts / vote_adjustments / modality_votes.
  const [existingDistinctions, setExistingDistinctions] = useState<Set<string>>(new Set());
  const [distinctionTarget, setDistinctionTarget] = useState<{
    business_id: string;
    business_name: string;
    position: number;
    total_votes: number;
  } | null>(null);
  const [creatingDistinction, setCreatingDistinction] = useState(false);
  const [distinctionFeedback, setDistinctionFeedback] = useState<string | null>(null);

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
  // FASE 5C.3.9 — modalidades da categoria no programa actual (só leitura de
  // definições; sem programa válido → [] fail-closed) + apuramento por
  // modalidade via RPC get_admin_modality_tally (só modality_votes).
  const programIdForModalities = adminCtx ? (adminCtx.selectedProgramId ?? null) : null;
  const modalitiesQuery = useScopedModalities(programIdForModalities, categoryId || null);
  const modalitiesOfCategory = useMemo(
    () => (modalitiesQuery.data ?? []).filter((m) => !categoryId || m.category_id === categoryId),
    [modalitiesQuery.data, categoryId],
  );
  const modalityTally = useAdminModalityTally(campaignId, cityId, categoryId, modalityId);

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

  // FASE 5C.3.10 — distinções já criadas no âmbito atual
  // (campanha × cidade × categoria × modalidade) para alternar
  // "Criar distinção" ↔ "Distinção criada" + "Gerir distinção".
  // Só leitura de award_distinctions; nunca escreve em votos.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setExistingDistinctions(new Set());
      if (!supabase || !campaignId || !cityId || !categoryId || !modalityId) return;
      try {
        const { data, error } = await supabase
          .from('award_distinctions')
          .select('business_id')
          .eq('campaign_id', campaignId)
          .eq('city_id', cityId)
          .eq('category_id', categoryId)
          .eq('modality_id', modalityId)
          .limit(1000);
        if (error) throw error;
        if (!cancelled) {
          setExistingDistinctions(
            new Set(((data ?? []) as { business_id: string }[]).map((d) => d.business_id)),
          );
        }
      } catch {
        if (!cancelled) setExistingDistinctions(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, cityId, categoryId, modalityId]);

  async function handleCreateDistinction() {
    setDistinctionFeedback(null);
    if (!distinctionTarget || !campaignId || !cityId || !categoryId || !modalityId) return;
    setCreatingDistinction(true);
    try {
      const result = await createDistinction({
        campaign_id: campaignId,
        city_id: cityId,
        category_id: categoryId,
        modality_id: modalityId,
        business_id: distinctionTarget.business_id,
        position: distinctionTarget.position,
        source: 'modality_vote',
      });
      if (result.duplicate) {
        setDistinctionFeedback('Esta empresa já possui uma distinção nesta modalidade.');
      } else {
        setExistingDistinctions((prev) => new Set(prev).add(distinctionTarget.business_id));
        setDistinctionTarget(null);
        showToast('success', `Distinção criada para ${distinctionTarget.business_name} (mérito: Selecionado, comercial: Pendente).`);
      }
    } catch (e) {
      setDistinctionFeedback(e instanceof Error ? e.message : 'Falha ao criar a distinção.');
    } finally {
      setCreatingDistinction(false);
    }
  }

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
  // FASE 5C.3.9 — ranking por modalidade (empates partilham posição; sem
  // ajustes: vote_adjustments NUNCA usado para modalidades; sem mistura com
  // o resultado principal — totais lidos só de modality_votes via RPC).
  const canQueryModality = Boolean(campaignId && cityId && categoryId && modalityId);
  const modalityTotal = (modalityTally.data ?? []).reduce((s, r) => s + r.total_votes, 0);
  const modalityRanked = (() => {
    const sorted = [...(modalityTally.data ?? [])].sort(
      (a, b) => b.total_votes - a.total_votes || a.business_name.localeCompare(b.business_name, 'pt-PT'),
    );
    let rank = 0;
    let prev = -1;
    return sorted.map((r, i) => {
      if (r.total_votes !== prev) {
        rank = i + 1;
        prev = r.total_votes;
      }
      return {
        ...r,
        position: rank,
        percentage: modalityTotal > 0 ? (r.total_votes / modalityTotal) * 100 : 0,
      };
    });
  })();
  const modalityName = modalitiesOfCategory.find((m) => m.id === modalityId)?.name ?? '—';
  const modalityFirstCount = modalityRanked.filter((r) => r.position === 1).length;

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

  // FASE 5C.3.9 — exportação agregada do apuramento por modalidade.
  // Só totais por empresa (sem ip_hash/device, sem ajustes, sem mistura
  // com o resultado principal).
  async function exportModalityCsv() {
    if (!canQueryModality || modalityRanked.length === 0) return;
    const city = cities.find((c) => c.id === cityId);
    const cat = categories.find((c) => c.id === categoryId);
    const header = 'posicao;negocio;cidade;categoria;modalidade;edicao;total_votos;percentagem';
    const lines = modalityRanked.map((r) => [
      r.position,
      `"${r.business_name.replace(/"/g, '""')}"`,
      `"${(city?.name ?? '').replace(/"/g, '""')}"`,
      `"${(cat?.name ?? '').replace(/"/g, '""')}"`,
      `"${modalityName.replace(/"/g, '""')}"`,
      campaign?.year ?? '',
      r.total_votes,
      r.percentage.toFixed(1).replace('.', ','),
    ].join(';'));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resultados-modalidade-${campaign?.year ?? 'edicao'}-${city?.slug ?? 'cidade'}-${cat?.slug ?? 'categoria'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await audit('results.modality_export', 'campaigns', campaignId, {
      city_id: cityId, category_id: categoryId, modality_id: modalityId,
      rows: modalityRanked.length, total_votes: modalityTotal,
    });
  }

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

      {/* FASE 5C.3.9 — apuramento por modalidade (destaques).
          Lê EXCLUSIVAMENTE via get_admin_modality_tally (modality_votes);
          nunca soma com votes, nunca usa vote_adjustments, nunca altera o
          resultado principal acima. Sem modalidade selecionada ou sem
          edição × cidade × categoria → estado vazio fail-closed. */}
      <AdminCard title="Apuramento por modalidade (destaques)" className="mt-4">
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-gold-500/20 bg-gold-500/[0.05] p-3.5 text-[13px] leading-relaxed text-slate-300">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />
          <p>
            Cada modalidade tem votação própria e independente (1 voto por pessoa <em>em cada</em> modalidade).
            Estes totais vêm só de <code className="font-mono text-xs text-gold-200">modality_votes</code> e{' '}
            <strong className="text-white">não se somam</strong> ao resultado principal. Publicação pública de
            modalidades: fase posterior — isto é apuramento interno.
          </p>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <Field label="Modalidade (destaques da categoria)">
            <Select
              value={modalityId}
              onChange={(e) => setModalityId(e.target.value)}
              disabled={!categoryId || modalitiesQuery.loading}
            >
              <option value="" className="bg-navy-900">
                {!categoryId
                  ? '— Escolha primeiro a categoria —'
                  : modalitiesQuery.loading
                    ? '— A carregar modalidades… —'
                    : modalitiesOfCategory.length === 0
                      ? '— Sem modalidades nesta categoria —'
                      : '— Escolher modalidade —'}
              </option>
              {modalitiesOfCategory.map((m) => (
                <option key={m.id} value={m.id} className="bg-navy-900">
                  {m.name}{m.active ? '' : ' (inactiva)'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Âmbito">
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-4 py-2.5 text-xs leading-relaxed text-slate-400">
              {campaign?.year ?? '—'} · {cityName} · {categoryName} · {modalityRanked.length} {modalityRanked.length === 1 ? 'empresa' : 'empresas'} · {modalityTotal} {modalityTotal === 1 ? 'voto' : 'votos'} na modalidade
            </p>
          </Field>
        </div>

        {!canQueryModality ? (
          <p className="rounded-xl border border-dashed border-white/15 py-8 text-center text-sm text-slate-500">
            Escolha uma edição, cidade, categoria e modalidade para ver o apuramento de destaques.
          </p>
        ) : modalityTally.loading ? (
          <PageLoading label="A apurar votos da modalidade…" />
        ) : modalityTally.error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[13px] leading-relaxed"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-red-200">Não foi possível carregar o apuramento da modalidade.</p>
              <p className="mt-1 break-words font-mono text-xs text-red-300/90">{modalityTally.error}</p>
            </div>
          </div>
        ) : (
          <>
            {modalityRanked.length > 0 && modalityFirstCount > 1 && (
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                <Medal className="h-3.5 w-3.5" /> Empate no 1.º lugar ({modalityFirstCount} empatados) — sem vencedor exclusivo.
              </p>
            )}
            <AdminTable<(typeof modalityRanked)[number]>
              rows={modalityRanked}
              searchable
              searchKeys={['business_name']}
              searchPlaceholder="Pesquisar empresa…"
              emptyMessage="Sem votos apurados nesta modalidade. A contagem preencher-se-á à medida que a votação decorre."
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
                { key: 'modality', label: 'Modalidade', render: () => <span className="text-slate-300">{modalityName}</span> },
                { key: 'total_votes', label: 'Votos', render: (r) => <strong className="text-gold-300">{r.total_votes}</strong> },
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
                  key: 'distinction', label: 'Distinção',
                  render: (r) => (
                    existingDistinctions.has(r.business_id) ? (
                      <span className="flex flex-col gap-1.5">
                        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200">
                          <BadgeCheck className="h-3 w-3" /> Distinção criada
                        </span>
                        <Link
                          to={`/admin/distincoes?city=${cityId}&category=${categoryId}&modality=${modalityId}&business=${encodeURIComponent(r.business_name)}`}
                          className="text-[11px] font-medium text-gold-300 underline hover:text-gold-200"
                        >
                          Gerir distinção
                        </Link>
                        <Link
                          to={`/admin/distincoes?city=${cityId}&category=${categoryId}&modality=${modalityId}&business=${encodeURIComponent(r.business_name)}`}
                          className="text-[11px] text-slate-400 underline hover:text-slate-200"
                        >
                          Ver distinção
                        </Link>
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setDistinctionFeedback(null);
                          setDistinctionTarget({
                            business_id: r.business_id,
                            business_name: r.business_name,
                            position: r.position,
                            total_votes: r.total_votes,
                          });
                        }}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-semibold text-gold-200 transition hover:bg-gold-500/20 active:scale-[0.98]"
                      >
                        <BadgeCheck className="h-3.5 w-3.5" />
                        Criar distinção
                      </button>
                    )
                  ),
                },
              ]}
            />
            {modalityRanked.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={exportModalityCsv}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300"
                >
                  <Download className="h-4 w-4" /> Exportar CSV (modalidade)
                </button>
                <span className="text-[11px] text-slate-500">A exportação inclui apenas totais agregados da modalidade — sem IP, hashes de dispositivo, ajustes ou dados de segurança.</span>
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

      {/* FASE 5C.3.10 — confirmação de criação de distinção a partir do
          resultado de modalidade. Defaults: source = modality_vote,
          award_status = selected, commercial_status = pending, notes = NULL.
          NÃO copia votos para award_distinctions; posição/votos só leitura
          via get_admin_modality_tally. */}
      {distinctionTarget && (
        <Modal title="Criar distinção a partir do resultado" onClose={() => (creatingDistinction ? null : setDistinctionTarget(null))}>
          <div className="space-y-3 text-sm">
            <FormError message={distinctionFeedback} />
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <dt className="text-slate-500">Empresa</dt>
              <dd className="font-semibold text-white">{distinctionTarget.business_name}</dd>
              <dt className="text-slate-500">Cidade</dt>
              <dd className="text-slate-200">{cityName}</dd>
              <dt className="text-slate-500">Categoria</dt>
              <dd className="text-slate-200">{categoryName}</dd>
              <dt className="text-slate-500">Modalidade</dt>
              <dd className="text-slate-200">{modalityName}</dd>
              <dt className="text-slate-500">Posição</dt>
              <dd className="text-slate-200">{distinctionTarget.position}.º (via get_admin_modality_tally)</dd>
              <dt className="text-slate-500">Votos</dt>
              <dd className="text-slate-200">{distinctionTarget.total_votes} (só leitura — não copiados)</dd>
              <dt className="text-slate-500">Origem</dt>
              <dd className="text-slate-200">Voto de modalidade (modality_vote)</dd>
            </dl>
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              Será criada com mérito <strong className="text-white">Selecionado</strong> e
              comercial <strong className="text-white">Pendente</strong>, sem copiar votos
              e sem alterar o resultado oficial.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDistinctionTarget(null)}
                disabled={creatingDistinction}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateDistinction}
                disabled={creatingDistinction}
                className="rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
              >
                {creatingDistinction ? 'A criar…' : 'Confirmar criação'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
