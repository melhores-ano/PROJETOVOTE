/**
 * THE BEST EUROPA — FASE 5C.3.10 — Admin > Distinções (pipeline operacional).
 *
 * Gestão operacional das distinções SEM manipular o resultado oficial:
 *  - award_status (mérito) e commercial_status (relação comercial) são
 *    dimensões INDEPENDENTES em award_distinctions.
 *  - Posição/votos lidos de get_admin_modality_tally (modality_votes);
 *    NUNCA recalculados nem copiados para award_distinctions.
 *  - commercial_status = declined apenas guarda o estado + auditoria.
 *    NUNCA altera award_status, votos, rankings ou cria outra distinção.
 *
 * Scope: AdminProgramProvider (única fonte) — programa + país + edição.
 * FAIL-CLOSED: sem programa válido → sem dados; sem edição válida →
 * sem criar/alterar distinções.
 *
 * SEM monetização, SEM seeds, SEM 2027, SEM novo país/programa.
 * NÃO toca em votes / vote_attempts / vote_adjustments / modality_votes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, PhoneCall, StickyNote } from 'lucide-react';
import {
  useScopedBusinesses,
  useScopedCategories,
  useScopedCities,
  useScopedDistinctions,
  useScopedModalities,
} from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  AWARD_STATUSES,
  AWARD_STATUS_LABELS,
  COMMERCIAL_STATUSES,
  COMMERCIAL_STATUS_LABELS,
  SOURCE_LABELS,
  comboKey,
  createDistinction,
  tallyKey,
  updateAwardStatus,
  updateCommercialStatus,
  updateDistinctionNotes,
} from '../../lib/distinctions';
import type {
  AwardDistinction,
  AwardStatus,
  CommercialStatus,
} from '../../types/database';
import {
  AdminHeader,
  AdminCard,
  AdminTable,
  SupabaseNotice,
} from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import {
  Field,
  Select,
  TextInput,
  TextArea,
  Modal,
  FormError,
  FormActions,
} from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface TallyEntry {
  position: number;
  total_votes: number;
}

interface ConfirmState {
  city_id: string;
  category_id: string;
  modality_id: string;
  business_id: string;
  business_name: string;
  position: number;
  total_votes: number;
}

function pillClass(kind: 'award' | 'commercial' | 'source', value: string): string {
  if (kind === 'source') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
  }
  const emerald = ['confirmed', 'winner', 'accepted'];
  const amber = ['selected', 'contacted'];
  const red = ['declined', 'cancelled'];
  if (emerald.includes(value)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (amber.includes(value)) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (red.includes(value)) return 'border-red-500/30 bg-red-500/10 text-red-200';
  return 'border-white/15 bg-white/5 text-slate-300';
}

export default function DistinctionsAdminPage() {
  const {
    selectedProgram,
    selectedProgramId,
    selectedCampaign,
    selectedCampaignId,
  } = useAdminProgram();
  const [searchParams] = useSearchParams();

  const countryCode = selectedProgram?.country_code ?? null;
  const citiesQuery = useScopedCities(countryCode);
  const categoriesQuery = useScopedCategories(selectedProgramId);
  const modalitiesQuery = useScopedModalities(selectedProgramId);
  const businessesQuery = useScopedBusinesses(countryCode);
  const distinctionsQuery = useScopedDistinctions(
    selectedCampaignId,
    selectedProgramId,
  );

  const [cityFilter, setCityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [modalityFilter, setModalityFilter] = useState('all');
  const [awardFilter, setAwardFilter] = useState('all');
  const [commercialFilter, setCommercialFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Deep-link a partir de Resultados ("Gerir distinção") ou Modalidades
  // ("Ver distinções"): ?city=&category=&modality=&business=
  useEffect(() => {
    const city = searchParams.get('city');
    const category = searchParams.get('category');
    const modality = searchParams.get('modality');
    if (city) setCityFilter(city);
    if (category) setCategoryFilter(category);
    if (modality) setModalityFilter(modality);
    const business = searchParams.get('business');
    if (business) setSearch(business);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tallyMap, setTallyMap] = useState<Record<string, TallyEntry>>({});
  const [tallyError, setTallyError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmInfo, setConfirmInfo] = useState<string | null>(null);

  const [notesTarget, setNotesTarget] = useState<AwardDistinction | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [rowError, setRowError] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId);
  const hasCampaign = Boolean(selectedCampaign && selectedCampaignId);

  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const modalities = useMemo(
    () => modalitiesQuery.data ?? [],
    [modalitiesQuery.data],
  );
  const businesses = useMemo(
    () => businessesQuery.data ?? [],
    [businessesQuery.data],
  );
  const distinctions = useMemo(
    () => distinctionsQuery.data ?? [],
    [distinctionsQuery.data],
  );

  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const modalityById = useMemo(
    () => new Map(modalities.map((m) => [m.id, m])),
    [modalities],
  );
  const businessById = useMemo(
    () => new Map(businesses.map((b) => [b.id, b])),
    [businesses],
  );

  // Modalidades disponíveis no filtro respeitam categoria selecionada.
  const modalityOptions = useMemo(
    () =>
      categoryFilter === 'all'
        ? modalities
        : modalities.filter((m) => m.category_id === categoryFilter),
    [modalities, categoryFilter],
  );

  const filtered = useMemo(() => {
    let rows = distinctions;
    if (cityFilter !== 'all') rows = rows.filter((d) => d.city_id === cityFilter);
    if (categoryFilter !== 'all') {
      rows = rows.filter((d) => d.category_id === categoryFilter);
    }
    if (modalityFilter !== 'all') {
      rows = rows.filter((d) => d.modality_id === modalityFilter);
    }
    if (awardFilter !== 'all') rows = rows.filter((d) => d.award_status === awardFilter);
    if (commercialFilter !== 'all') {
      rows = rows.filter((d) => d.commercial_status === commercialFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) => {
        const name =
          businessById.get(d.business_id)?.name ?? d.business_id;
        return name.toLowerCase().includes(q);
      });
    }
    return rows;
  }, [
    distinctions,
    cityFilter,
    categoryFilter,
    modalityFilter,
    awardFilter,
    commercialFilter,
    search,
    businessById,
  ]);

  // Posição/votos SEMPRE de get_admin_modality_tally (nunca de
  // award_distinctions). Agrupa por combinação (cidade × categoria ×
  // modalidade) e consulta a RPC uma vez por combinação (cap fail-safe).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTallyError(null);
      if (!supabase || !selectedCampaignId || filtered.length === 0) {
        if (!cancelled) setTallyMap({});
        return;
      }
      const combos = new Map<string, { city: string; category: string; modality: string }>();
      for (const d of filtered) {
        const k = comboKey(d.city_id, d.category_id, d.modality_id);
        if (!combos.has(k)) {
          combos.set(k, {
            city: d.city_id,
            category: d.category_id,
            modality: d.modality_id,
          });
        }
        if (combos.size >= 25) break;
      }
      const client = supabase;
      if (!client) {
        if (!cancelled) setTallyMap({});
        return;
      }
      try {
        const entries = await Promise.all(
          [...combos.entries()].map(async ([ck, c]) => {
            const { data, error } = await client.rpc(
              'get_admin_modality_tally',
              {
                p_campaign_id: selectedCampaignId,
                p_city_id: c.city,
                p_category_id: c.category,
                p_modality_id: c.modality,
              },
            );
            if (error) throw error;
            return {
              ck,
              city: c.city,
              category: c.category,
              modality: c.modality,
              rows: (data ?? []) as {
                business_id: string;
                total_votes: number | string;
                position: number | string;
              }[],
            };
          }),
        );
        if (cancelled) return;
        const map: Record<string, TallyEntry> = {};
        for (const g of entries) {
          for (const r of g.rows) {
            map[
              tallyKey(g.city, g.category, g.modality, String(r.business_id))
            ] = {
              position: Number(r.position ?? 0),
              total_votes: Number(r.total_votes ?? 0),
            };
          }
        }
        setTallyMap(map);
      } catch (e) {
        if (!cancelled) {
          setTallyMap({});
          setTallyError(
            e instanceof Error ? e.message : 'Falha ao ler o apuramento das modalidades.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtered, selectedCampaignId]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const pending = filtered.filter((d) => d.commercial_status === 'pending').length;
    const contacted = filtered.filter((d) => d.commercial_status === 'contacted').length;
    const accepted = filtered.filter((d) => d.commercial_status === 'accepted').length;
    const declined = filtered.filter((d) => d.commercial_status === 'declined').length;
    const confirmed = filtered.filter((d) => d.commercial_status === 'confirmed').length;
    return { total, pending, contacted, accepted, declined, confirmed };
  }, [filtered]);

  const loading =
    citiesQuery.loading ||
    categoriesQuery.loading ||
    modalitiesQuery.loading ||
    businessesQuery.loading ||
    distinctionsQuery.loading;

  async function handleCreateFromTally() {
    setConfirmError(null);
    setConfirmInfo(null);
    if (!confirm || !selectedCampaignId) return;
    if (!hasProgram || !hasCampaign) {
      setConfirmError(
        'Sem edição válida — selecione um programa e uma edição antes de criar distinções.',
      );
      return;
    }
    setCreating(true);
    try {
      const result = await createDistinction({
        campaign_id: selectedCampaignId,
        city_id: confirm.city_id,
        category_id: confirm.category_id,
        modality_id: confirm.modality_id,
        business_id: confirm.business_id,
        position: confirm.position,
        source: 'modality_vote',
      });
      if (result.duplicate) {
        setConfirmInfo(
          'Esta empresa já possui uma distinção nesta modalidade.',
        );
      } else {
        setConfirm(null);
        distinctionsQuery.refetch();
      }
    } catch (e) {
      setConfirmError(
        e instanceof Error ? e.message : 'Falha ao criar a distinção.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleAwardChange(d: AwardDistinction, next: AwardStatus) {
    setRowError(null);
    if (!hasCampaign || !selectedCampaignId) {
      setRowError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    try {
      await updateAwardStatus(d, next, {
        campaign_id: selectedCampaignId,
        city_id: d.city_id,
        category_id: d.category_id,
        modality_id: d.modality_id,
        business_id: d.business_id,
        previous: d.award_status,
      });
      distinctionsQuery.refetch();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Falha ao alterar o mérito.');
    }
  }

  async function handleCommercialChange(d: AwardDistinction, next: CommercialStatus) {
    setRowError(null);
    if (!hasCampaign || !selectedCampaignId) {
      setRowError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    try {
      // REGRA ABSOLUTA: declined guarda-se e nada mais acontece.
      // Esta função altera SOMENTE commercial_status (ver lib/distinctions).
      await updateCommercialStatus(d, next, {
        campaign_id: selectedCampaignId,
        city_id: d.city_id,
        category_id: d.category_id,
        modality_id: d.modality_id,
        business_id: d.business_id,
        previous: d.commercial_status,
      });
      distinctionsQuery.refetch();
    } catch (e) {
      setRowError(
        e instanceof Error ? e.message : 'Falha ao alterar o estado comercial.',
      );
    }
  }

  function openNotes(d: AwardDistinction) {
    setNotesTarget(d);
    setNotesDraft(d.notes ?? '');
    setNotesError(null);
  }

  async function handleSaveNotes(e: React.FormEvent) {
    e.preventDefault();
    if (!notesTarget) return;
    if (!hasCampaign) {
      setNotesError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    setSavingNotes(true);
    setNotesError(null);
    try {
      await updateDistinctionNotes(notesTarget, notesDraft);
      setNotesTarget(null);
      distinctionsQuery.refetch();
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : 'Falha ao guardar as notas.');
    } finally {
      setSavingNotes(false);
    }
  }

  if (loading) return <PageLoading label="A carregar distinções…" />;

  const cards: { label: string; value: number; hint: string }[] = [
    { label: 'Total de distinções', value: summary.total, hint: 'edição atual' },
    { label: 'Pendentes de contacto', value: summary.pending, hint: 'commercial = pendente' },
    { label: 'Contactadas', value: summary.contacted, hint: 'commercial = contactado' },
    { label: 'Aceites', value: summary.accepted, hint: 'commercial = aceite' },
    { label: 'Recusadas', value: summary.declined, hint: 'sem efeito no mérito' },
    { label: 'Confirmadas', value: summary.confirmed, hint: 'commercial = confirmado' },
  ];

  return (
    <div>
      <AdminHeader
        title="Distinções"
        description={`Gestão operacional das distinções do programa${selectedProgram ? ` · ${selectedProgram.name}` : ' (sem programa válido)'} — mérito e relação comercial em separado, sem alterar o resultado oficial.`}
      />
      <SupabaseNotice />
      <AdminScopeBanner requireCampaign />

      {!hasProgram ? (
        <ErrorState
          message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma distinção é apresentada por fallback."
          onRetry={distinctionsQuery.refetch}
        />
      ) : !hasCampaign ? (
        <ErrorState
          message="Sem edição válida selecionada — selecione uma edição do programa. A criação e alteração de distinções estão bloqueadas."
          onRetry={distinctionsQuery.refetch}
        />
      ) : distinctionsQuery.error && filtered.length === 0 ? (
        <ErrorState message={distinctionsQuery.error} onRetry={distinctionsQuery.refetch} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {cards.map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {c.label}
                </p>
                <p className="mt-1 text-2xl font-bold text-white">{c.value}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{c.hint}</p>
              </div>
            ))}
          </div>

          <AdminCard title={`Filtros — ${selectedProgram?.name}`} className="mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cidade (somente do país do programa)">
                <Select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todas as cidades</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Categoria (somente do programa)">
                <Select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setModalityFilter('all');
                  }}
                >
                  <option value="all" className="bg-navy-900">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Modalidade (somente do programa)">
                <Select value={modalityFilter} onChange={(e) => setModalityFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todas as modalidades</option>
                  {modalityOptions.map((m) => (
                    <option key={m.id} value={m.id} className="bg-navy-900">{m.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Estado da distinção (mérito)">
                <Select value={awardFilter} onChange={(e) => setAwardFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todos</option>
                  {AWARD_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-navy-900">{AWARD_STATUS_LABELS[s]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Estado comercial">
                <Select value={commercialFilter} onChange={(e) => setCommercialFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todos</option>
                  {COMMERCIAL_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-navy-900">{COMMERCIAL_STATUS_LABELS[s]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Pesquisa por empresa">
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nome da empresa…"
                />
              </Field>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Edição em análise: {selectedCampaign?.year} — {selectedCampaign?.name}.
              Posição e votos apresentados abaixo vêm de{' '}
              <code className="font-mono text-gold-200">get_admin_modality_tally</code>{' '}
              (modality_votes) — nunca copiados para award_distinctions.
            </p>
            {tallyError && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                Apuramento das modalidades indisponível: {tallyError}
              </p>
            )}
            {rowError && (
              <p role="alert" className="mt-2 text-xs text-red-300">{rowError}</p>
            )}
          </AdminCard>

          <div className="mt-4">
            <AdminCard title={`Distinções — ${selectedProgram?.name} (${filtered.length})`}>
              <AdminTable<AwardDistinction & Record<string, unknown>>
                rows={filtered.map((d) => ({ ...d }))}
                searchable={false}
                emptyMessage="Sem distinções para os filtros selecionados. Crie distinções a partir de Admin → Resultados → Resultados das modalidades (ação “Criar distinção”)."
                columns={[
                  {
                    key: 'business_id',
                    label: 'Empresa',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <span className="font-medium text-white">
                          {businessById.get(d.business_id)?.name ?? d.business_id.slice(0, 8)}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'city_id',
                    label: 'Cidade',
                    render: (r) => (
                      <span className="text-xs text-slate-300">
                        {cityById.get(String((r as unknown as AwardDistinction).city_id))?.name ?? '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'category_id',
                    label: 'Categoria',
                    render: (r) => (
                      <span className="text-xs text-slate-300">
                        {categoryById.get(String((r as unknown as AwardDistinction).category_id))?.name ?? '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'modality_id',
                    label: 'Modalidade',
                    render: (r) => (
                      <span className="text-xs text-slate-300">
                        {modalityById.get(String((r as unknown as AwardDistinction).modality_id))?.name ?? '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'position',
                    label: 'Posição (modalidade)',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const t = tallyMap[tallyKey(d.city_id, d.category_id, d.modality_id, d.business_id)];
                      return (
                        <span className="text-xs text-slate-200" title="Via get_admin_modality_tally">
                          {t ? `${t.position}.º` : '—'}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'votes',
                    label: 'Votos (modalidade)',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const t = tallyMap[tallyKey(d.city_id, d.category_id, d.modality_id, d.business_id)];
                      return (
                        <strong className="text-xs text-gold-300" title="Via get_admin_modality_tally">
                          {t ? t.total_votes : '—'}
                        </strong>
                      );
                    },
                  },
                  {
                    key: 'award_status',
                    label: 'Distinção (mérito)',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <span className="flex flex-col gap-1.5">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pillClass('award', d.award_status)}`}>
                            <Award className="h-3 w-3" />
                            {AWARD_STATUS_LABELS[d.award_status] ?? d.award_status}
                          </span>
                          <select
                            aria-label="Alterar estado da distinção"
                            value={d.award_status}
                            disabled={!isSupabaseConfigured || !hasCampaign}
                            onChange={(e) => handleAwardChange(d, e.target.value as AwardStatus)}
                            className="w-32 rounded-lg border border-white/15 bg-navy-950 px-2 py-1 text-[11px] text-slate-200"
                          >
                            {AWARD_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-navy-900">{AWARD_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'commercial_status',
                    label: 'Comercial',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <span className="flex flex-col gap-1.5">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pillClass('commercial', d.commercial_status)}`}>
                            <PhoneCall className="h-3 w-3" />
                            {COMMERCIAL_STATUS_LABELS[d.commercial_status] ?? d.commercial_status}
                          </span>
                          <select
                            aria-label="Alterar estado comercial"
                            value={d.commercial_status}
                            disabled={!isSupabaseConfigured || !hasCampaign}
                            onChange={(e) => handleCommercialChange(d, e.target.value as CommercialStatus)}
                            className="w-32 rounded-lg border border-white/15 bg-navy-950 px-2 py-1 text-[11px] text-slate-200"
                          >
                            {COMMERCIAL_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-navy-900">{COMMERCIAL_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'source',
                    label: 'Origem',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pillClass('source', d.source)}`}>
                          {SOURCE_LABELS[d.source] ?? d.source}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'updated_at',
                    label: 'Atualização',
                    render: (r) => (
                      <span className="text-[11px] text-slate-500">
                        {new Date(String(r.updated_at)).toLocaleString('pt-PT')}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    label: 'Ações',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <button
                          onClick={() => openNotes(d)}
                          disabled={!hasCampaign}
                          title={d.notes ? d.notes : 'Editar notas comerciais'}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                        >
                          <StickyNote className="h-3 w-3" />
                          {d.notes ? 'Notas ✓' : 'Notas'}
                        </button>
                      );
                    },
                  },
                ]}
              />
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Recusa comercial (Recusado) apenas guarda o estado e a auditoria — nunca
                altera o mérito, nunca transfere prémios, nunca promove o segundo colocado,
                nunca altera votos ou rankings.
              </p>
            </AdminCard>
          </div>
        </>
      )}

      {confirm && (
        <Modal
          title="Criar distinção a partir do resultado"
          onClose={() => (creating ? null : setConfirm(null))}
        >
          <div className="space-y-3 text-sm">
            <FormError message={confirmError} />
            {confirmInfo && (
              <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                {confirmInfo}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <dt className="text-slate-500">Empresa</dt>
              <dd className="font-semibold text-white">{confirm.business_name}</dd>
              <dt className="text-slate-500">Cidade</dt>
              <dd className="text-slate-200">{cityById.get(confirm.city_id)?.name ?? '—'}</dd>
              <dt className="text-slate-500">Categoria</dt>
              <dd className="text-slate-200">{categoryById.get(confirm.category_id)?.name ?? '—'}</dd>
              <dt className="text-slate-500">Modalidade</dt>
              <dd className="text-slate-200">{modalityById.get(confirm.modality_id)?.name ?? '—'}</dd>
              <dt className="text-slate-500">Posição</dt>
              <dd className="text-slate-200">{confirm.position}.º (via get_admin_modality_tally)</dd>
              <dt className="text-slate-500">Votos</dt>
              <dd className="text-slate-200">{confirm.total_votes} (só leitura — não copiados)</dd>
              <dt className="text-slate-500">Origem</dt>
              <dd className="text-slate-200">Voto de modalidade (modality_vote)</dd>
            </dl>
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              Será criada com mérito <strong className="text-white">Selecionado</strong> e
              comercial <strong className="text-white">Pendente</strong>, posição{' '}
              {confirm.position}.º, sem copiar votos.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={creating}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateFromTally}
                disabled={creating || !isSupabaseConfigured}
                className="rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
              >
                {creating ? 'A criar…' : 'Confirmar criação'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {notesTarget && (
        <Modal title={`Notas comerciais — ${businessById.get(notesTarget.business_id)?.name ?? 'empresa'}`} onClose={() => setNotesTarget(null)}>
          <form onSubmit={handleSaveNotes} className="space-y-4">
            <FormError message={notesError} />
            <Field label="Notas (ex.: contactado por telefone em 20/09)">
              <TextArea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                placeholder="Notas da relação comercial…"
              />
            </Field>
            <FormActions onCancel={() => setNotesTarget(null)} saving={savingNotes} saveLabel="Guardar notas" />
          </form>
        </Modal>
      )}
    </div>
  );
}
