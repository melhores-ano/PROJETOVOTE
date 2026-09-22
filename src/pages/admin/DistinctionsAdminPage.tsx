/**
 * THE BEST EUROPA — FASE 5C.3.11 + 5C.3.12 — Admin > Distinções.
 *
 * Ferramenta operacional pós-votação SEM manipular o resultado oficial:
 *  - Colunas separadas: EMPRESA / CIDADE / CATEGORIA / MODALIDADE / POSIÇÃO
 *    (via get_admin_modality_tally) / ORIGEM / MÉRITO (award_status) /
 *    ESTADO COMERCIAL (commercial_status) / RECONHECIMENTO (fulfillment) /
 *    NOTAS / ÚLTIMA ATUALIZAÇÃO.
 *  - award_status (mérito), commercial_status (relação comercial) e
 *    fulfillment (reconhecimento/entrega, 5C.3.12) são dimensões
 *    INDEPENDENTES. Fulfillment NUNCA altera mérito, comercial, votos,
 *    rankings, vencedores ou resultados públicos.
 *  - commercial_status = declined mostra "Recusou a distinção" mas preserva
 *    empresa, modalidade, posição, award_status, votos e histórico. NUNCA
 *    altera mérito, votos, rankings ou cria outra distinção.
 *  - Pipeline comercial (CRM simples, SEM pagamento):
 *      Pendente → Contactado → Aceite → Confirmado,
 *      Pendente/Contactado → Recusado, qualquer → Cancelado.
 *  - Reconhecimento (5C.3.12, SEM pagamentos, SEM gerador de PDF/imagem):
 *      Certificado · Selo digital · Placa · Troféu, cada um com estado
 *      Pendente|Em preparação|Pronto|Entregue|Cancelado + notas
 *      administrativas (nunca públicas) + entrega simples para físicos
 *      (Levantamento|Entrega|Evento + tracking + delivered_at).
 *  - Ações rápidas usam SOMENTE updateCommercialStatus (auditado);
 *    reconhecimento usa SOMENTE a lib fulfillment (auditada).
 *
 * Scope: AdminProgramProvider (única fonte) — programa + país + edição.
 * FAIL-CLOSED: sem programa válido → sem dados; sem edição válida →
 * sem criar/alterar distinções ou reconhecimento.
 *
 * SEM monetização, SEM seeds, SEM 2027, SEM novo país/programa.
 * NÃO toca em votes / vote_attempts / vote_adjustments / modality_votes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, PackageCheck, PhoneCall, StickyNote } from 'lucide-react';
import {
  useScopedBusinesses,
  useScopedCategories,
  useScopedCities,
  useScopedDistinctions,
  useScopedFulfillment,
  useScopedModalities,
} from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  AWARD_STATUSES,
  AWARD_STATUS_LABELS,
  COMMERCIAL_QUICK_ACTIONS,
  COMMERCIAL_STATUSES,
  COMMERCIAL_STATUS_LABELS,
  SOURCE_LABELS,
  comboKey,
  createDistinction,
  nextCommercialTransitions,
  tallyKey,
  updateAwardStatus,
  updateCommercialStatus,
  updateDistinctionNotes,
} from '../../lib/distinctions';
import {
  FULFILLMENT_DELIVERY_LABELS,
  FULFILLMENT_DELIVERY_METHODS,
  FULFILLMENT_ITEM_LABELS,
  FULFILLMENT_ITEM_TYPES,
  FULFILLMENT_STATUS_LABELS,
  FULFILLMENT_STATUSES,
  createFulfillmentItem,
  fulfillmentCompactLabel,
  fulfillmentEligibilityHint,
  isPhysicalFulfillmentItem,
  removeFulfillmentItem,
  summarizeFulfillment,
  updateFulfillmentItem,
} from '../../lib/fulfillment';
import type {
  AwardDistinction,
  AwardStatus,
  CommercialStatus,
  DistinctionFulfillment,
  FulfillmentDeliveryMethod,
  FulfillmentItemType,
  FulfillmentStatus,
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

function pillClass(kind: 'award' | 'commercial' | 'source' | 'fulfillment', value: string): string {
  if (kind === 'source') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
  }
  if (kind === 'fulfillment') {
    if (value === 'delivered') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    if (value === 'ready') return 'border-teal-500/30 bg-teal-500/10 text-teal-200';
    if (value === 'preparing') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    if (value === 'cancelled') return 'border-red-500/30 bg-red-500/10 text-red-200';
    return 'border-white/15 bg-white/5 text-slate-300';
  }
  const emerald = ['confirmed', 'winner', 'accepted'];
  const amber = ['selected', 'contacted'];
  const red = ['declined', 'cancelled'];
  if (emerald.includes(value)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (amber.includes(value)) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (red.includes(value)) return 'border-red-500/30 bg-red-500/10 text-red-200';
  return 'border-white/15 bg-white/5 text-slate-300';
}

/* ---------------------------------------------------------------------------
 * FASE 5C.3.12 — Gestor de reconhecimento/entrega (modal por distinção).
 * Permite selecionar [ ] Certificado [ ] Selo digital [ ] Placa [ ] Troféu;
 * para cada item: estado, notas administrativas, método de entrega +
 * tracking + delivered_at (físicos), última atualização. NÃO gera PDF/imagem,
 * NÃO altera mérito/comercial/votos/ranking — escreve SOMENTE em
 * distinction_fulfillment via lib fulfillment (auditada). Fail-closed: sem
 * edição válida → escrita bloqueada.
 * ------------------------------------------------------------------------- */

function FulfillmentManager({
  distinction,
  businessName,
  items,
  hasCampaign,
  onChanged,
  onClose,
}: {
  distinction: AwardDistinction;
  businessName: string;
  items: DistinctionFulfillment[];
  hasCampaign: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const byType = useMemo(() => {
    const m = new Map<FulfillmentItemType, DistinctionFulfillment>();
    for (const it of items) m.set(it.item_type, it);
    return m;
  }, [items]);
  const [selected, setSelected] = useState<Record<FulfillmentItemType, boolean>>(() => ({
    certificate: byType.has('certificate'),
    digital_seal: byType.has('digital_seal'),
    plaque: byType.has('plaque'),
    trophy: byType.has('trophy'),
  }));
  const [drafts, setDrafts] = useState<
    Record<
      FulfillmentItemType,
      {
        status: FulfillmentStatus;
        notes: string;
        delivery_method: '' | FulfillmentDeliveryMethod;
        tracking_reference: string;
        delivered_at: string;
      }
    >
  >(() => {
    const mk = (t: FulfillmentItemType) => {
      const ex = byType.get(t);
      return {
        status: ex?.status ?? ('pending' as FulfillmentStatus),
        notes: ex?.notes ?? '',
        delivery_method: (ex?.delivery_method ?? '') as '' | FulfillmentDeliveryMethod,
        tracking_reference: ex?.tracking_reference ?? '',
        delivered_at: ex?.delivered_at ? String(ex.delivered_at).slice(0, 16) : '',
      };
    };
    return {
      certificate: mk('certificate'),
      digital_seal: mk('digital_seal'),
      plaque: mk('plaque'),
      trophy: mk('trophy'),
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const eligibilityHint = fulfillmentEligibilityHint(distinction);

  function toggle(t: FulfillmentItemType, v: boolean) {
    setSelected((s) => ({ ...s, [t]: v }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!hasCampaign) {
      setError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    setSaving(true);
    try {
      // Para cada tipo: selecionado sem registo → INSERT; selecionado com
      // registo → UPDATE; desselecionado com registo → DELETE (remoção
      // estrutural; preferir estado Cancelado quando for só operacional).
      for (const t of FULFILLMENT_ITEM_TYPES) {
        const existing = byType.get(t);
        const want = selected[t];
        const d = drafts[t];
        if (want && !existing) {
          const physical = isPhysicalFulfillmentItem(t);
          const res = await createFulfillmentItem({
            award_distinction_id: distinction.id,
            item_type: t,
            status: d.status,
            notes: d.notes.trim() === '' ? null : d.notes.trim(),
            delivery_method: physical && d.delivery_method !== '' ? d.delivery_method : null,
            tracking_reference: physical && d.tracking_reference.trim() !== '' ? d.tracking_reference.trim() : null,
            delivered_at:
              d.status === 'delivered' && d.delivered_at !== ''
                ? new Date(d.delivered_at).toISOString()
                : null,
          });
          if (res.duplicate) {
            await updateFulfillmentItem(
              { id: (byType.get(t)?.id ?? '') as string },
              {},
            ).catch(() => undefined);
          }
        } else if (want && existing) {
          const physical = isPhysicalFulfillmentItem(t);
          await updateFulfillmentItem(
            { id: existing.id },
            {
              status: d.status,
              notes: d.notes.trim() === '' ? null : d.notes.trim(),
              delivery_method: physical ? (d.delivery_method === '' ? null : d.delivery_method) : null,
              tracking_reference:
                physical ? (d.tracking_reference.trim() === '' ? null : d.tracking_reference.trim()) : null,
              delivered_at:
                d.status === 'delivered' && d.delivered_at !== ''
                  ? new Date(d.delivered_at).toISOString()
                  : d.status === 'delivered'
                    ? existing.delivered_at
                    : null,
            },
          );
        } else if (!want && existing) {
          await removeFulfillmentItem({
            id: existing.id,
            award_distinction_id: existing.award_distinction_id,
            item_type: existing.item_type,
          });
        }
      }
      setInfo('Reconhecimento guardado. Mérito, relação comercial, votos e ranking inalterados.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao guardar o reconhecimento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Gerir reconhecimento — ${businessName}`} onClose={onClose} wide>
      <form onSubmit={handleSave} className="space-y-4">
        <FormError message={error} />
        {info && (
          <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
            {info}
          </p>
        )}
        {eligibilityHint && (
          <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200">
            {eligibilityHint} O reconhecimento é apenas operacional e nunca altera os outros estados.
          </p>
        )}
        <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs leading-relaxed text-slate-400">
          Controlo administrativo (sem gerador de PDF/imagem): assinale os itens aplicáveis. Cada item tem estado
          próprio (Pendente · Em preparação · Pronto · Entregue · Cancelado) e notas administrativas — nunca públicas.
          Placa e Troféu aceitam dados de entrega (Levantamento · Entrega · Evento + referência + data).
        </p>
        <div className="space-y-3">
          {FULFILLMENT_ITEM_TYPES.map((t) => {
            const existing = byType.get(t);
            const d = drafts[t];
            const physical = isPhysicalFulfillmentItem(t);
            return (
              <fieldset key={t} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected[t]}
                    onChange={(e) => toggle(t, e.target.checked)}
                    className="h-4 w-4 accent-yellow-500"
                  />
                  <span className="text-sm font-semibold text-white">{FULFILLMENT_ITEM_LABELS[t]}</span>
                  {existing && (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pillClass('fulfillment', existing.status)}`}>
                      {FULFILLMENT_STATUS_LABELS[existing.status]}
                    </span>
                  )}
                  {!physical && (
                    <span className="text-[11px] text-slate-500">(controlo administrativo — sem ficheiro gerado)</span>
                  )}
                </label>
                {selected[t] && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Estado">
                      <Select
                        value={d.status}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t]: { ...prev[t], status: e.target.value as FulfillmentStatus },
                          }))
                        }
                      >
                        {FULFILLMENT_STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-navy-900">
                            {FULFILLMENT_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Data de entrega (quando aplicável)">
                      <TextInput
                        type="datetime-local"
                        value={d.delivered_at}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t]: { ...prev[t], delivered_at: e.target.value },
                          }))
                        }
                      />
                    </Field>
                    {physical && (
                      <>
                        <Field label="Método de entrega">
                          <Select
                            value={d.delivery_method}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [t]: {
                                  ...prev[t],
                                  delivery_method: e.target.value as '' | FulfillmentDeliveryMethod,
                                },
                              }))
                            }
                          >
                            <option value="" className="bg-navy-900">— Não aplicável —</option>
                            {FULFILLMENT_DELIVERY_METHODS.map((m) => (
                              <option key={m} value={m} className="bg-navy-900">
                                {FULFILLMENT_DELIVERY_LABELS[m]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Referência de entrega (tracking)">
                          <TextInput
                            value={d.tracking_reference}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [t]: { ...prev[t], tracking_reference: e.target.value },
                              }))
                            }
                            placeholder="Ex.: EVENTO-2026-014"
                          />
                        </Field>
                      </>
                    )}
                    <div className={physical ? 'sm:col-span-2' : 'sm:col-span-2'}>
                      <Field label="Notas administrativas (nunca públicas)">
                        <TextArea
                          value={d.notes}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [t]: { ...prev[t], notes: e.target.value },
                            }))
                          }
                          rows={2}
                          placeholder={
                            t === 'plaque'
                              ? 'Ex.: Placa enviada para produção'
                              : t === 'certificate'
                                ? 'Ex.: Certificado conferido'
                                : t === 'digital_seal'
                                  ? 'Ex.: Selo digital pronto a enviar'
                                  : 'Ex.: Entrega prevista no evento'
                          }
                        />
                      </Field>
                    </div>
                    {existing && (
                      <p className="text-[11px] text-slate-500 sm:col-span-2">
                        Última atualização: {new Date(String(existing.updated_at)).toLocaleString('pt-PT')}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>
        <FormActions onCancel={onClose} saving={saving} saveLabel="Guardar reconhecimento" />
      </form>
    </Modal>
  );
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

  // FASE 5C.3.12 — reconhecimento/entrega (quarta dimensão, independente).
  const [fulfillmentTarget, setFulfillmentTarget] = useState<AwardDistinction | null>(null);

  const [rowError, setRowError] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

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

  // FASE 5C.3.12 — mapa distinção → itens de reconhecimento.
  // Isolado por campanha/programa porque os IDs vêm de `distinctions`
  // (já filtradas por selectedCampaignId + programa). Fail-closed: sem
  // distinções → {} (hook retorna vazio, nunca global).
  const distinctionIds = useMemo(() => distinctions.map((d) => d.id), [distinctions]);
  const fulfillmentQuery = useScopedFulfillment(distinctionIds);
  const fulfillmentByDistinction = useMemo(
    () => fulfillmentQuery.data ?? {},
    [fulfillmentQuery.data],
  );
  // Resumo OPERACIONAL (nunca votos/ranking): agregado sobre os itens.
  const fulfillmentSummary = useMemo(() => {
    const all: DistinctionFulfillment[] = Object.values(fulfillmentByDistinction).flat();
    return summarizeFulfillment(all);
  }, [fulfillmentByDistinction]);

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
    if (d.commercial_status === next) return;
    setBusyRowId(d.id);
    try {
      // REGRA ABSOLUTA: declined guarda-se e nada mais acontece.
      // Esta função altera SOMENTE commercial_status (ver lib/distinctions).
      // NUNCA altera award_status, NUNCA cria nova distinção, NUNCA transfere
      // posição, NUNCA toca em votos/rankings.
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
    } finally {
      setBusyRowId(null);
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

      {/* FASE 5C.3.11 — pipeline operacional: mérito × comercial sempre separados.
          commercial_status NUNCA altera award_status automaticamente. */}
      <div className="mb-4 rounded-2xl border border-gold-500/20 bg-gold-500/[0.05] p-4 text-[13px] leading-relaxed text-slate-300">
        <p className="font-semibold text-white">Fluxo operacional — mérito ≠ comercial</p>
        <p className="mt-1">
          Pipeline comercial: <strong className="text-white">Pendente → Contactado → Aceite → Confirmado</strong>
          {' '}· alternativas: <strong className="text-white">Pendente/Contactado → Recusado</strong>
          {' '}· <strong className="text-white">qualquer estado → Cancelado</strong>.
          A recusa (<strong className="text-red-200">Recusou a distinção</strong>) preserva empresa, modalidade,
          posição, mérito, votos e histórico — sem transferir prémios nem criar vencedores.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Mérito (award_status): Elegível · Selecionado · Vencedor · Confirmado · Cancelado — alterado apenas pelo
          controlo de mérito. Comercial (commercial_status): Pendente · Contactado · Aceite · Recusado · Confirmado ·
          Cancelado — CRM simples, sem módulo financeiro.
        </p>
      </div>

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

          {/* FASE 5C.3.12 — resumo OPERACIONAL do reconhecimento (nunca
              votos/ranking). Números sobre distinction_fulfillment. */}
          <div className="mt-3 rounded-2xl border border-teal-500/20 bg-teal-500/[0.04] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Reconhecimento — resumo operacional
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: 'Reconhecimentos pendentes', value: fulfillmentSummary.pending, hint: 'fulfillment = pendente' },
                { label: 'Em preparação', value: fulfillmentSummary.preparing, hint: 'fulfillment = em preparação' },
                { label: 'Prontos', value: fulfillmentSummary.ready, hint: 'fulfillment = pronto' },
                { label: 'Entregues', value: fulfillmentSummary.delivered, hint: 'fulfillment = entregue' },
                { label: 'Total de itens', value: fulfillmentSummary.total, hint: 'itens configurados' },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-white/10 bg-navy-950/50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{c.label}</p>
                  <p className="mt-1 text-xl font-bold text-white">{c.value}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{c.hint}</p>
                </div>
              ))}
            </div>
            {fulfillmentQuery.error && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                Reconhecimento indisponível: {fulfillmentQuery.error}
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Números operacionais sobre o reconhecimento/entrega — nunca misturados com votos ou ranking.
            </p>
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
                    label: 'Estado comercial',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const busy = busyRowId === d.id;
                      const suggested = nextCommercialTransitions(d.commercial_status);
                      const quickLabel = (s: CommercialStatus): string =>
                        COMMERCIAL_QUICK_ACTIONS.find((a) => a.next === s)?.label ?? s;
                      return (
                        <span className="flex min-w-44 flex-col gap-1.5">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pillClass('commercial', d.commercial_status)}`}>
                            <PhoneCall className="h-3 w-3" />
                            {COMMERCIAL_STATUS_LABELS[d.commercial_status] ?? d.commercial_status}
                          </span>
                          {d.commercial_status === 'declined' && (
                            <span role="status" className="inline-flex w-fit items-center rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-200">
                              Recusou a distinção — mérito preservado, sem transferência
                            </span>
                          )}
                          <select
                            aria-label="Alterar estado comercial"
                            value={d.commercial_status}
                            disabled={!isSupabaseConfigured || !hasCampaign || busy}
                            onChange={(e) => handleCommercialChange(d, e.target.value as CommercialStatus)}
                            className="w-36 rounded-lg border border-white/15 bg-navy-950 px-2 py-1 text-[11px] text-slate-200"
                          >
                            {COMMERCIAL_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-navy-900">{COMMERCIAL_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                          <span className="flex max-w-52 flex-wrap gap-1" aria-label="Ações rápidas comerciais">
                            {suggested.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => handleCommercialChange(d, s)}
                                disabled={!isSupabaseConfigured || !hasCampaign || busy || d.commercial_status === s}
                                title={quickLabel(s)}
                                className="rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                              >
                                {busy ? '…' : quickLabel(s).replace('Marcar como ', '').replace('Confirmar', 'Confirmar').replace('Cancelar', 'Cancelar')}
                              </button>
                            ))}
                          </span>
                          <span className="sr-only">
                            {COMMERCIAL_QUICK_ACTIONS.map((a) => a.label).join(' · ')}
                          </span>
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
                    key: 'fulfillment',
                    label: 'Reconhecimento',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const items = fulfillmentByDistinction[d.id] ?? [];
                      return (
                        <span className="flex min-w-44 flex-col gap-1.5">
                          <span className="text-[11px] leading-relaxed text-slate-300" title="Resumo operacional do reconhecimento">
                            {fulfillmentCompactLabel(items)}
                          </span>
                          {items.length > 0 && (
                            <span className="flex max-w-52 flex-wrap gap-1">
                              {items.map((it) => (
                                <span
                                  key={it.id}
                                  title={`${FULFILLMENT_ITEM_LABELS[it.item_type]} — ${FULFILLMENT_STATUS_LABELS[it.status]}`}
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pillClass('fulfillment', it.status)}`}
                                >
                                  {FULFILLMENT_ITEM_LABELS[it.item_type]} · {FULFILLMENT_STATUS_LABELS[it.status]}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setFulfillmentTarget(d)}
                              disabled={!hasCampaign}
                              title={items.length > 0 ? 'Ver reconhecimento' : 'Configurar reconhecimento'}
                              className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 text-xs font-semibold text-teal-200 transition hover:bg-teal-500/20 disabled:opacity-40"
                            >
                              <PackageCheck className="h-3 w-3" />
                              {items.length > 0 ? 'Ver reconhecimento' : 'Configurar'}
                            </button>
                            {items.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setFulfillmentTarget(d)}
                                disabled={!hasCampaign}
                                title="Gerir reconhecimento"
                                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                              >
                                Gerir reconhecimento
                              </button>
                            )}
                          </span>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'notes',
                    label: 'Notas',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const text = (d.notes ?? '').trim();
                      return text ? (
                        <span className="block max-w-52 truncate text-[11px] text-slate-300" title={text}>
                          {text}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-600">— sem notas (administrativas, sem exposição pública)</span>
                      );
                    },
                  },
                  {
                    key: 'updated_at',
                    label: 'Última atualização',
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

      {/* FASE 5C.3.12 — gerir reconhecimento/entrega (quarta dimensão).
          Escreve SOMENTE em distinction_fulfillment; nunca altera mérito,
          comercial, votos, ranking ou resultados públicos. */}
      {fulfillmentTarget && (
        <FulfillmentManager
          distinction={fulfillmentTarget}
          businessName={businessById.get(fulfillmentTarget.business_id)?.name ?? 'empresa'}
          items={fulfillmentByDistinction[fulfillmentTarget.id] ?? []}
          hasCampaign={hasCampaign}
          onChanged={() => {
            fulfillmentQuery.refetch();
          }}
          onClose={() => setFulfillmentTarget(null)}
        />
      )}
    </div>
  );
}
