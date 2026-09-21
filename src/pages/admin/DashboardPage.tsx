/**
 * THE BEST EUROPA — FASE 5C.3.7 — Admin > Painel (isolado).
 *
 * - Métricas campaign-scoped (votos, timeline, ranking) usam
 *   selectedCampaignId do AdminProgramProvider.
 * - Métricas program-scoped (cidades, categorias, empresas) usam
 *   selectedProgramId / country_code — nunca somam outros programas.
 * - Faixa visual indica sempre QUAL programa e QUAL edição em análise.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, MapPin, Tags, Store, Megaphone, Vote,
  Trophy, Medal, TrendingUp,
} from 'lucide-react';
import { useScopedBusinesses, useScopedCategories, useScopedCities, useAuditLogs } from '../../hooks/useAdminData';
import { useAdminVoteOverview, useAdminVoteTimeline } from '../../hooks/useAdminVoteStats';
import { supabase } from '../../lib/supabase';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { belongsToCountry, belongsToProgram } from '../../lib/awardProgram';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Select } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';
import { formatDatePt } from '../../lib/utils';

interface RankRow {
  business_id: string;
  business_name: string;
  city_name: string;
  category_name: string;
  total_votes: number;
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 min-w-[80px] flex-1 overflow-hidden rounded-full bg-white/10 sm:max-w-[220px]" aria-hidden>
      <div className="h-full rounded-full bg-gold-gradient" style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(5, 10);
  }
}

export default function DashboardPage() {
  // 5C.3.7: contexto Admin (única fonte) — programa + edição.
  const adminCtx = useAdminProgram();
  const { selectedProgram, selectedProgramId, campaigns, selectedCampaign, selectedCampaignId, setSelectedCampaign } = adminCtx;
  const countryCode = selectedProgram?.country_code ?? null;

  // 5C.3.7: cobertura program-scoped (nunca global).
  const citiesQuery = useScopedCities(countryCode);
  const categoriesQuery = useScopedCategories(selectedProgramId);
  const businessesQuery = useScopedBusinesses(countryCode);
  const auditQuery = useAuditLogs(6);

  const campaignId = selectedCampaignId ?? '';
  const [ranking, setRanking] = useState<RankRow[]>([]);
  const [rankingLoading, setRankingLoading] = useState(true);

  const campaign = selectedCampaign;
  const overview = useAdminVoteOverview(campaignId || undefined);
  const timeline = useAdminVoteTimeline(campaignId || undefined, 30);

  // Ranking privado ao vivo: top 10 da EDIÇÃO selecionada (fail-closed
  // por programa: cidades/categorias fora do programa são excluídas).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRankingLoading(true);
      if (!supabase || !campaignId || !selectedProgramId || !countryCode) {
        if (!cancelled) {
          setRanking([]);
          setRankingLoading(false);
        }
        return;
      }
      try {
        const { data: votes } = await supabase
          .from('votes')
          .select('business_id, city_id, category_id')
          .eq('campaign_id', campaignId)
          .limit(10000);
        const counts = new Map<string, { total: number; city_id: string; category_id: string }>();
        for (const v of (votes ?? []) as { business_id: string; city_id: string; category_id: string }[]) {
          const prev = counts.get(v.business_id);
          if (prev) prev.total += 1;
          else counts.set(v.business_id, { total: 1, city_id: v.city_id, category_id: v.category_id });
        }
        const top = [...counts.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
        if (top.length === 0) {
          if (!cancelled) setRanking([]);
          return;
        }
        const ids = top.map(([id]) => id);
        const [{ data: biz }, { data: cityRows }, { data: catRows }] = await Promise.all([
          supabase.from('businesses').select('id, name').in('id', ids),
          supabase.from('cities').select('id, name, country_code'),
          supabase.from('categories').select('id, name, award_program_id'),
        ]);
        const bizById = new Map(((biz ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
        const cityById = new Map(
          ((cityRows ?? []) as { id: string; name: string; country_code: string | null }[])
            .filter((c) => belongsToCountry(c.country_code, countryCode))
            .map((c) => [c.id, c.name]),
        );
        const catById = new Map(
          ((catRows ?? []) as { id: string; name: string; award_program_id: string | null }[])
            .filter((c) => belongsToProgram(c.award_program_id, selectedProgramId))
            .map((c) => [c.id, c.name]),
        );
        if (!cancelled) {
          setRanking(top.map(([business_id, info]) => ({
            business_id,
            business_name: bizById.get(business_id) ?? business_id.slice(0, 8),
            city_name: cityById.get(info.city_id) ?? '—',
            category_name: catById.get(info.category_id) ?? '—',
            total_votes: info.total,
          })));
        }
      } catch {
        if (!cancelled) setRanking([]);
      } finally {
        if (!cancelled) setRankingLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, selectedProgramId, countryCode]);

  const ov = overview.data;
  const maxCity = Math.max(0, ...(ov?.by_city.map((c) => c.total_votes) ?? [0]));
  const maxCat = Math.max(0, ...(ov?.by_category.map((c) => c.total_votes) ?? [0]));
  const maxDay = Math.max(1, ...(timeline.data ?? []).map((d) => d.total_votes));
  const totalBusinesses = businessesQuery.data?.length ?? 0;
  const scopeLabel = useMemo(
    () => (selectedProgram ? `${selectedProgram.name} (${countryCode})` : 'sem programa válido'),
    [selectedProgram, countryCode],
  );

  if (!selectedProgram) {
    return (
      <div>
        <AdminHeader title="Painel geral" description="Visão operacional por programa e edição." />
        <SupabaseNotice />
        <AdminScopeBanner requireCampaign />
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma métrica é apresentada por fallback." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Painel geral"
        description={`Visão operacional de ${scopeLabel} — edição ${campaign ? `${campaign.year} (${campaign.name})` : '—'}: votos, participação e apuramento privado ao vivo.`}
        actions={
          campaigns.length > 0 ? (
            <div className="w-64">
              <Select value={campaignId} onChange={(e) => setSelectedCampaign(e.target.value)} aria-label="Edição em análise">
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id} className="bg-navy-900">
                    {c.year} · {c.status}{c.results_public ? ' · público' : ''}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner requireCampaign />

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: Vote, label: 'Total de votos', value: overview.loading ? '…' : String(ov?.total_votes ?? 0), hint: campaign ? `Edição ${campaign.year} · ${selectedProgram?.name}` : 'Sem edição' },
          { icon: CalendarDays, label: 'Votos hoje', value: overview.loading ? '…' : String(ov?.votes_today ?? 0), hint: `Últimos 7 dias: ${ov?.votes_last_7d ?? 0}` },
          { icon: Store, label: 'Empresas do programa', value: businessesQuery.loading ? '…' : String(totalBusinesses), hint: `${selectedProgram?.name}` },
          { icon: MapPin, label: `Cidades (${countryCode})`, value: citiesQuery.loading ? '…' : String(citiesQuery.data?.length ?? 0), hint: `${categoriesQuery.data?.length ?? 0} categorias do programa` },
        ].map((s) => (
          <AdminCard key={s.label}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10">
                <s.icon className="h-5 w-5 text-gold-400" />
              </span>
              <div>
                <p className="font-display text-2xl font-bold text-white">{s.value}</p>
                <p className="text-xs font-medium text-slate-300">{s.label}</p>
                <p className="text-[11px] text-slate-500">{s.hint}</p>
              </div>
            </div>
          </AdminCard>
        ))}
      </div>

      {/* Campanha actual */}
      <AdminCard title="Edição em análise" className="mt-4">
        {campaign ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-3">
              <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><Megaphone className="h-3.5 w-3.5" /> Campanha</dt>
              <dd className="mt-1 font-semibold text-white">{campaign.name} ({campaign.year})</dd>
              <dd className="text-xs text-slate-500">Estado: <strong className="text-gold-300">{campaign.status}</strong> · Resultados {campaign.results_public ? 'públicos' : 'privados'}</dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Início</dt>
              <dd className="mt-1 font-medium text-white">{formatDatePt(campaign.start_at)}</dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Fim</dt>
              <dd className="mt-1 font-medium text-white">{formatDatePt(campaign.end_at)}</dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-3">
              <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><Tags className="h-3.5 w-3.5" /> Cobertura do programa</dt>
              <dd className="mt-1 text-white">{citiesQuery.data?.length ?? 0} cidades ({countryCode}) · {categoriesQuery.data?.length ?? 0} categorias</dd>
              <dd><Link to="/admin/campanhas" className="text-xs text-gold-300 underline">Gerir edições <ArrowRight className="inline h-3 w-3" /></Link></dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Sem campanha seleccionada. <Link to="/admin/campanhas" className="text-gold-300 underline">Criar edição</Link></p>
        )}
      </AdminCard>

      {/* Gráficos */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <AdminCard title="Votos ao longo do tempo — últimos 30 dias" className="lg:col-span-3">
          {timeline.loading ? (
            <PageLoading label="A carregar evolução…" />
          ) : (timeline.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sem votos nesta edição. A curva preencher-se-á com a votação.</p>
          ) : (
            <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Votos por dia">
              {(timeline.data ?? []).map((d) => (
                <div key={d.day} className="group flex flex-1 flex-col items-center justify-end gap-1.5" title={`${d.day}: ${d.total_votes} votos`}>
                  <span className="text-[11px] font-semibold text-gold-300 opacity-0 transition group-hover:opacity-100">{d.total_votes}</span>
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-gold-700/60 to-gold-300 transition group-hover:brightness-125"
                    style={{ height: `${Math.max(4, Math.round((d.total_votes / maxDay) * 100))}%`, minHeight: d.total_votes > 0 ? 8 : 3 }}
                  />
                  <span className="hidden text-[10px] text-slate-500 sm:block">{formatDay(d.day)}</span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
        <AdminCard title="Votos por cidade" className="lg:col-span-2">
          {(ov?.by_city ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sem repartição por cidade.</p>
          ) : (
            <ul className="space-y-3">
              {(ov?.by_city ?? []).slice(0, 7).map((c) => (
                <li key={c.city_id} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-[13px] text-white">{c.city_name}</span>
                  <Bar value={c.total_votes} max={maxCity} />
                  <strong className="w-12 shrink-0 text-right text-sm text-gold-300">{c.total_votes}</strong>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Votos por categoria">
          {(ov?.by_category ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sem repartição por categoria.</p>
          ) : (
            <ul className="space-y-3">
              {(ov?.by_category ?? []).slice(0, 7).map((c) => (
                <li key={c.category_id} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-[13px] text-white">{c.category_name}</span>
                  <Bar value={c.total_votes} max={maxCat} />
                  <strong className="w-12 shrink-0 text-right text-sm text-gold-300">{c.total_votes}</strong>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        {/* Ranking privado ao vivo */}
        <AdminCard title="Apuramento privado ao vivo — Top 10 (só administradores)">
          {rankingLoading ? (
            <PageLoading label="A apurar…" />
          ) : (
            <AdminTable<RankRow & { pos?: number }>
              rows={ranking.map((r, i) => ({ ...r, pos: i + 1 }))}
              emptyMessage="Sem votos apurados nesta edição."
              columns={[
                { key: 'pos', label: '#', render: (r) => (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    {r.pos === 1 ? <Trophy className="h-4 w-4 text-gold-400" /> : r.pos !== undefined && r.pos <= 3 ? <Medal className="h-4 w-4 text-slate-300" /> : null}
                    {r.pos}º
                  </span>
                ) },
                { key: 'business_name', label: 'Negócio', render: (r) => <span className="font-medium text-white">{r.business_name}</span> },
                { key: 'category_name', label: 'Categoria' },
                { key: 'city_name', label: 'Cidade' },
                { key: 'total_votes', label: 'Votos', render: (r) => <strong className="text-gold-300">{r.total_votes}</strong> },
              ]}
            />
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Totais exactos visíveis apenas a administradores autenticados. Nunca publicar estes números enquanto results_public=false.
          </p>
        </AdminCard>
      </div>

      <AdminCard title="Actividade recente (auditoria)" className="mt-4">
        {(auditQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Sem eventos. <Link to="/admin/auditoria" className="text-gold-300 underline">Ver auditoria completa</Link></p>
        ) : (
          <ul className="space-y-2.5">
            {auditQuery.data.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-navy-950/50 px-3.5 py-2.5 text-sm">
                <code className="truncate text-xs text-gold-300">{log.action} · {log.entity ?? '—'}</code>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                  {(() => { try { return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(log.created_at)); } catch { return ''; } })()}
                  <Link to="/admin/auditoria" className="text-gold-300 hover:underline">Ver <ArrowRight className="inline h-3 w-3" /></Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
