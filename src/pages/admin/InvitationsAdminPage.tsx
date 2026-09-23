import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, CheckCircle2, PhoneCall, ThumbsUp, ThumbsDown, RefreshCcw } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import type { Business, Campaign, Category, City, ParticipantInvitation } from '../../types/database';
import { useOptionalAdminProgram } from '../../hooks/useAdminProgram';
import { useParticipantInvitations } from '../../hooks/useParticipantInvitations';
import { useScopedCategoryAreas } from '../../hooks/useCategoryAreas';
import {
  INVITATION_AUDIT_ACTIONS,
  INVITATION_CONTACT_METHOD_LABELS,
  INVITATION_STATUS_LABELS,
  canTransition,
  confirmInvitationForVoting,
  contactMethodLabel,
  createInvitation,
  summarizeByCategory,
  transitionInvitation,
  updateInvitationNotes,
} from '../../lib/participantInvitations';
import type { InvitationContactMethod, InvitationStatus } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { Field, TextInput, TextArea, Select, Modal, FormError, FormActions } from '../../components/AdminForm';
import { PageLoading } from '../../components/ui';

const STATUS_OPTIONS: InvitationStatus[] = ['potential', 'contacted', 'accepted', 'declined', 'confirmed'];
const METHOD_OPTIONS: InvitationContactMethod[] = ['phone', 'whatsapp', 'email', 'in_person', 'other'];

function statusPill(status: InvitationStatus) {
  const styles: Record<InvitationStatus, string> = {
    potential: 'border-white/15 text-slate-300',
    contacted: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    declined: 'border-red-500/40 bg-red-500/10 text-red-200',
    confirmed: 'border-gold-500/50 bg-gold-500/15 text-gold-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {INVITATION_STATUS_LABELS[status]}
    </span>
  );
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('pt-PT');
  } catch {
    return String(v);
  }
}

interface CreateForm {
  campaign_id: string;
  city_id: string;
  category_id: string;
  business_id: string;
  start_contacted: boolean;
  contact_method: InvitationContactMethod | '';
  contact_person: string;
  notes: string;
}

export default function InvitationsAdminPage() {
  const adminCtx = useOptionalAdminProgram();
  const adminProgramId = adminCtx?.selectedProgramId ?? null;
  const adminCampaignId = adminCtx?.selectedCampaignId ?? null;

  const [filterCity, setFilterCity] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');

  const campaignId = adminCtx ? (adminCampaignId ?? '') : '';

  const { rows, loading, error, reload } = useParticipantInvitations({
    campaign_id: campaignId || undefined,
    city_id: filterCity || undefined,
    category_id: filterCategory || undefined,
    status: filterStatus || undefined,
    search: search || undefined,
  });

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState<ParticipantInvitation | null>(null);
  const [form, setForm] = useState<CreateForm>({
    campaign_id: '', city_id: '', category_id: '', business_id: '',
    start_contacted: false, contact_method: '', contact_person: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [methodDraft, setMethodDraft] = useState<InvitationContactMethod | ''>('');
  const [personDraft, setPersonDraft] = useState('');
  const [acceptanceDraft, setAcceptanceDraft] = useState('');
  const [manageError, setManageError] = useState<string | null>(null);

  // FASE 6.1.1 — alvos dos modais operacionais (nunca alteram schema).
  const [contactedTarget, setContactedTarget] = useState<ParticipantInvitation | null>(null);
  const [contactedMethod, setContactedMethod] = useState<InvitationContactMethod | ''>('');
  const [contactedPerson, setContactedPerson] = useState('');
  const [contactedNotes, setContactedNotes] = useState('');
  const [contactedError, setContactedError] = useState<string | null>(null);
  const [acceptedTarget, setAcceptedTarget] = useState<ParticipantInvitation | null>(null);
  const [acceptedReference, setAcceptedReference] = useState('');
  const [acceptedNotes, setAcceptedNotes] = useState('');
  const [acceptedError, setAcceptedError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ParticipantInvitation | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const loadLookups = useCallback(async () => {
    if (!supabase) return;
    const [campRes, cityRes, catRes, bizRes] = await Promise.all([
      adminProgramId
        ? supabase.from('campaigns').select('*').eq('award_program_id', adminProgramId).order('year', { ascending: false })
        : supabase.from('campaigns').select('*').order('year', { ascending: false }),
      supabase.from('cities').select('*').order('name'),
      adminProgramId
        ? supabase.from('categories').select('*').eq('award_program_id', adminProgramId).order('name')
        : supabase.from('categories').select('*').order('name'),
      supabase.from('businesses').select('*').eq('active', true).order('name').limit(2000),
    ]);
    setCampaigns(((campRes.data ?? []) as Campaign[]).filter((c) => (adminProgramId ? c.award_program_id === adminProgramId : true)));
    setCities((cityRes.data ?? []) as City[]);
    setCategories((catRes.data ?? []) as Category[]);
    setBusinesses((bizRes.data ?? []) as Business[]);
  }, [adminProgramId]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    if (detail) {
      setNotesDraft(detail.notes ?? '');
      setMethodDraft(detail.contact_method ?? '');
      setPersonDraft(detail.contact_person ?? '');
      setAcceptanceDraft(detail.acceptance_reference ?? '');
      setManageError(null);
    }
  }, [detail]);

  const summary = useMemo(() => {
    const totals: Record<string, number> = { potential: 0, contacted: 0, accepted: 0, declined: 0, confirmed: 0 };
    for (const r of rows) totals[r.status] = (totals[r.status] ?? 0) + 1;
    return totals;
  }, [rows]);

  const byCategory = useMemo(() => summarizeByCategory(rows), [rows]);
  // FASE 6.2: Área derivada através da categoria (SOMENTE visual — NÃO
  // altera participant_invitations schema nem a lógica da Fase 6.1).
  const areasQuery = useScopedCategoryAreas(adminProgramId);
  const areasById = useMemo(() => new Map((areasQuery.data ?? []).map((a) => [a.id, a])), [areasQuery.data]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryName = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.name]));
    for (const r of rows) {
      const c = r.category as unknown as { name?: string } | null;
      if (c?.name) m.set(r.category_id, c.name);
    }
    return m;
  }, [categories, rows]);

  function openCreate() {
    setForm({
      campaign_id: campaignId || campaigns[0]?.id || '',
      city_id: filterCity,
      category_id: filterCategory,
      business_id: '',
      start_contacted: false,
      contact_method: '',
      contact_person: '',
      notes: '',
    });
    setFormError(null);
    setModal(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    if (!form.campaign_id || !form.city_id || !form.category_id || !form.business_id) {
      setFormError('Edição, cidade, categoria e empresa são obrigatórios.');
      return;
    }
    const dup = rows.some(
      (r) => r.campaign_id === form.campaign_id && r.city_id === form.city_id && r.category_id === form.category_id && r.business_id === form.business_id,
    );
    if (dup) {
      setFormError('Já existe um convite para esta edição × cidade × categoria × empresa.');
      return;
    }
    setSaving(true);
    try {
      await createInvitation({
        campaign_id: form.campaign_id,
        city_id: form.city_id,
        category_id: form.category_id,
        business_id: form.business_id,
        status: form.start_contacted ? 'contacted' : 'potential',
        contact_method: form.start_contacted ? ((form.contact_method as InvitationContactMethod) || 'other') : null,
        contact_person: form.contact_person || null,
        notes: form.notes || null,
      });
      setModal(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao criar o convite.');
    } finally {
      setSaving(false);
    }
  }

  async function runTransition(inv: ParticipantInvitation, to: InvitationStatus) {
    setActionError(null);
    if (!canTransition(inv.status, to)) {
      setActionError(`Transição inválida: «${INVITATION_STATUS_LABELS[inv.status]}» → «${INVITATION_STATUS_LABELS[to]}».`);
      return;
    }
    setActingId(inv.id);
    try {
      if (to === 'confirmed') {
        await confirmInvitationForVoting(inv);
      } else {
        await transitionInvitation(inv, to, {
          contact_method: (methodDraft as InvitationContactMethod) || inv.contact_method || (to === 'declined' ? undefined : 'other'),
        });
      }
      setDetail(null);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha na transição de estado.');
    } finally {
      setActingId(null);
    }
  }

  // FASE 6.1.1 — abrir modal "Marcar como Contactada" (meio obrigatório).
  function openContactedModal(inv: ParticipantInvitation) {
    setContactedTarget(inv);
    setContactedMethod(inv.contact_method ?? '');
    setContactedPerson(inv.contact_person ?? '');
    setContactedNotes('');
    setContactedError(null);
    setActionError(null);
  }

  async function submitContacted(e: React.FormEvent) {
    e.preventDefault();
    if (!contactedTarget) return;
    if (!contactedMethod) {
      setContactedError('Escolha o meio de contacto (obrigatório).');
      return;
    }
    setContactedError(null);
    setActingId(contactedTarget.id);
    try {
      const patch: { contact_method: InvitationContactMethod; contact_person?: string | null; notes?: string | null } = {
        contact_method: contactedMethod,
      };
      if (contactedPerson.trim() !== '') patch.contact_person = contactedPerson.trim();
      else if (!contactedTarget.contact_person) patch.contact_person = null;
      if (contactedNotes.trim() !== '') {
        const prev = (contactedTarget.notes ?? '').trim();
        patch.notes = prev === '' ? contactedNotes.trim() : `${prev}\n\n— ${contactedNotes.trim()}`;
      }
      await transitionInvitation(contactedTarget, 'contacted', patch);
      setContactedTarget(null);
      if (detail?.id === contactedTarget.id) setDetail(null);
      reload();
    } catch (err) {
      setContactedError(err instanceof Error ? err.message : 'Falha ao marcar como contactada.');
    } finally {
      setActingId(null);
    }
  }

  // FASE 6.1.1 — abrir modal "Marcar como Aceitou" (referência opcional, notas anexadas).
  function openAcceptedModal(inv: ParticipantInvitation) {
    setAcceptedTarget(inv);
    setAcceptedReference(inv.acceptance_reference ?? '');
    setAcceptedNotes('');
    setAcceptedError(null);
    setActionError(null);
  }

  async function submitAccepted(e: React.FormEvent) {
    e.preventDefault();
    if (!acceptedTarget) return;
    setAcceptedError(null);
    setActingId(acceptedTarget.id);
    try {
      const patch: { contact_method?: InvitationContactMethod; acceptance_reference?: string | null; notes?: string } = {};
      if (!acceptedTarget.contact_method) patch.contact_method = 'other';
      const ref = acceptedReference.trim();
      if (ref !== '') patch.acceptance_reference = ref;
      else if (!acceptedTarget.acceptance_reference) patch.acceptance_reference = null;
      // Notas adicionais: a lib anexa de forma segura sem apagar o histórico.
      if (acceptedNotes.trim() !== '') patch.notes = acceptedNotes.trim();
      await transitionInvitation(acceptedTarget, 'accepted', patch);
      setAcceptedTarget(null);
      if (detail?.id === acceptedTarget.id) setDetail(null);
      reload();
    } catch (err) {
      setAcceptedError(err instanceof Error ? err.message : 'Falha ao marcar como aceite.');
    } finally {
      setActingId(null);
    }
  }

  // FASE 6.1.1 — abrir modal visual "Confirmar para votação" (substitui window.confirm).
  function openConfirmModal(inv: ParticipantInvitation) {
    setConfirmTarget(inv);
    setConfirmError(null);
    setActionError(null);
  }

  async function submitConfirm() {
    if (!confirmTarget) return;
    setConfirmError(null);
    setActingId(confirmTarget.id);
    try {
      await confirmInvitationForVoting(confirmTarget);
      setConfirmTarget(null);
      if (detail?.id === confirmTarget.id) setDetail(null);
      reload();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Falha ao confirmar para votação.');
    } finally {
      setActingId(null);
    }
  }

  async function saveManage(inv: ParticipantInvitation) {
    setManageError(null);
    setActionError(null);
    setActingId(inv.id);
    try {
      await updateInvitationNotes(inv.id, {
        contact_method: methodDraft ? (methodDraft as InvitationContactMethod) : null,
        contact_person: personDraft,
        acceptance_reference: acceptanceDraft,
        notes: notesDraft,
      });
      const updated: ParticipantInvitation = {
        ...inv,
        contact_method: methodDraft ? (methodDraft as InvitationContactMethod) : null,
        contact_person: personDraft.trim() === '' ? null : personDraft.trim(),
        acceptance_reference: acceptanceDraft.trim() === '' ? null : acceptanceDraft.trim(),
        notes: notesDraft.trim() === '' ? null : notesDraft,
      };
      setDetail(updated);
      reload();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Falha ao guardar.');
    } finally {
      setActingId(null);
    }
  }

  if (loading && rows.length === 0) return <PageLoading label="A carregar convites…" />;

  const bizName = (r: ParticipantInvitation) =>
    (r.business as unknown as { name?: string } | null)?.name ?? businesses.find((b) => b.id === r.business_id)?.name ?? '—';
  const cityName = (r: ParticipantInvitation) =>
    (r.city as unknown as { name?: string } | null)?.name ?? cities.find((c) => c.id === r.city_id)?.name ?? '—';
  const catName = (r: ParticipantInvitation) =>
    (r.category as unknown as { name?: string } | null)?.name ?? categoryName.get(r.category_id) ?? '—';
  // FASE 6.2: área derivada da categoria (visual); "—" quando sem área.
  const areaName = (r: ParticipantInvitation) => {
    const joined = (r.category as unknown as { area_id?: string | null } | null)?.area_id ?? null;
    const areaId = joined ?? categoryById.get(r.category_id)?.area_id ?? null;
    if (!areaId) return '—';
    return areasById.get(areaId)?.name ?? '—';
  };

  return (
    <div>
      <AdminHeader
        title="Convites"
        description="Funil pré-votação: Potencial → Contactada → Aceitou → Confirmada para votação (Recusou é saída lateral). Só a confirmação cria/associa a participação efectiva em campaign_entries. Participação gratuita; aceitação sem obrigação de compra."
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured}
            title={isSupabaseConfigured ? 'Novo convite' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Novo convite
          </button>
        }
      />
      <SupabaseNotice />
      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      )}
      {actionError && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{actionError}</div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        {STATUS_OPTIONS.map((s) => (
          <div key={s} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">{INVITATION_STATUS_LABELS[s]}</p>
            <p className="mt-1 font-display text-2xl font-bold text-white">{summary[s] ?? 0}</p>
          </div>
        ))}
      </div>

      <AdminCard title="Filtros — edição × cidade × categoria × estado" className="mb-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Cidade">
            <Select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
              <option value="" className="bg-navy-900">Todas</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Categoria">
            <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="" className="bg-navy-900">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="" className="bg-navy-900">Todos</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} className="bg-navy-900">{INVITATION_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Pesquisa">
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Empresa, cidade, categoria…" />
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {rows.length} convites · edição do contexto Admin · meta piloto: 3–5 confirmadas por categoria (ver resumo abaixo, sem bloqueios automáticos).
        </p>
      </AdminCard>

      <AdminCard title={`Convites (${rows.length})`}>
        <AdminTable<ParticipantInvitation>
          searchable={false}
          rows={rows}
          emptyMessage="Sem convites para estes filtros. Crie o primeiro convite como Potencial e avance no funil."
          columns={[
            { key: 'business', label: 'Empresa', render: (r) => <span className="font-medium text-white">{bizName(r)}</span> },
            { key: 'city', label: 'Cidade', render: (r) => <span>{cityName(r)}</span> },
            { key: 'category', label: 'Categoria', render: (r) => <span>{catName(r)}</span> },
            { key: 'area', label: 'Área', render: (r) => <span className="text-xs text-gold-300/90">{areaName(r)}</span> },
            { key: 'status', label: 'Estado', render: (r) => statusPill(r.status) },
            { key: 'contact', label: 'Contacto', render: (r) => <span className="text-xs text-slate-400">{contactMethodLabel(r.contact_method)}</span> },
            { key: 'entry', label: 'Entry', render: (r) => <span className="text-xs text-slate-400">{r.campaign_entry_id ? 'associada' : '—'}</span> },
            {
              key: 'actions', label: 'Acções',
              render: (r) => (
                <span className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setDetail(r)}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                  >
                    Gerir
                  </button>
                  {canTransition(r.status, 'contacted') && (
                    <button
                      onClick={() => openContactedModal(r)}
                      disabled={actingId === r.id}
                      title="Marcar como contactada"
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 px-2.5 py-1 text-xs text-sky-200 hover:bg-sky-500/10 disabled:opacity-40"
                    >
                      <PhoneCall className="h-3 w-3" /> Contactada
                    </button>
                  )}
                  {canTransition(r.status, 'accepted') && (
                    <button
                      onClick={() => openAcceptedModal(r)}
                      disabled={actingId === r.id}
                      title="Marcar como aceite"
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1 text-xs text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
                    >
                      <ThumbsUp className="h-3 w-3" /> Aceitou
                    </button>
                  )}
                  {canTransition(r.status, 'confirmed') && (
                    <button
                      onClick={() => openConfirmModal(r)}
                      disabled={actingId === r.id}
                      title="Confirmar para votação (cria/associa entry)"
                      className="inline-flex items-center gap-1 rounded-lg border border-gold-500/40 px-2.5 py-1 text-xs text-gold-200 hover:bg-gold-500/10 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Confirmar
                    </button>
                  )}
                  {canTransition(r.status, 'declined') && (
                    <button
                      onClick={() => runTransition(r, 'declined')}
                      disabled={actingId === r.id}
                      title="Marcar como recusada"
                      className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <ThumbsDown className="h-3 w-3" /> Recusou
                    </button>
                  )}
                </span>
              ),
            },
          ]}
        />
      </AdminCard>

      {byCategory.length > 0 && (
        <AdminCard title="Resumo por categoria (confirmadas — meta 3–5)" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-4">Categoria</th>
                  <th className="pb-2 pr-4">Potenciais</th>
                  <th className="pb-2 pr-4">Contactadas</th>
                  <th className="pb-2 pr-4">Aceites</th>
                  <th className="pb-2 pr-4">Recusadas</th>
                  <th className="pb-2 pr-4">Confirmadas</th>
                  <th className="pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((row) => (
                  <tr key={row.category_id} className="border-t border-white/5">
                    <td className="py-2 pr-4 font-medium text-white">{categoryName.get(row.category_id) ?? row.category_id.slice(0, 8)}</td>
                    <td className="py-2 pr-4 text-slate-400">{row.potential}</td>
                    <td className="py-2 pr-4 text-slate-400">{row.contacted}</td>
                    <td className="py-2 pr-4 text-slate-400">{row.accepted}</td>
                    <td className="py-2 pr-4 text-slate-400">{row.declined}</td>
                    <td className="py-2 pr-4 font-semibold text-gold-300">{row.confirmed}</td>
                    <td className="py-2 text-slate-400">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {modal && (
        <Modal title="Novo convite" onClose={() => setModal(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <FormError message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Edição">
                <Select value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })} required>
                  <option value="" className="bg-navy-900">— Escolher —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.year} · {c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Cidade">
                <Select value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })} required>
                  <option value="" className="bg-navy-900">— Escolher —</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Categoria">
                <Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required>
                  <option value="" className="bg-navy-900">— Escolher —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Empresa">
                <Select value={form.business_id} onChange={(e) => setForm({ ...form, business_id: e.target.value })} required>
                  <option value="" className="bg-navy-900">— Escolher —</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id} className="bg-navy-900">{b.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.start_contacted}
                onChange={(e) => setForm({ ...form, start_contacted: e.target.checked })}
                className="h-4 w-4 accent-yellow-500"
              />
              Registar já como Contactada (primeiro contacto feito)
            </label>
            {form.start_contacted && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Forma de contacto">
                  <Select value={form.contact_method} onChange={(e) => setForm({ ...form, contact_method: e.target.value as InvitationContactMethod | '' })}>
                    <option value="" className="bg-navy-900">— Escolher —</option>
                    {METHOD_OPTIONS.map((m) => (
                      <option key={m} value={m} className="bg-navy-900">{INVITATION_CONTACT_METHOD_LABELS[m]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Pessoa de contacto (interno)">
                  <TextInput value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="Quem falou com a empresa" />
                </Field>
              </div>
            )}
            <Field label="Notas internas">
              <TextArea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas internas (nunca públicas)" rows={3} />
            </Field>
            <FormActions onCancel={() => setModal(false)} saving={saving} saveLabel="Criar convite" />
          </form>
        </Modal>
      )}

      {/* FASE 6.1.1 — modal Marcar como Contactada */}
      {contactedTarget && (
        <Modal title={`Marcar como Contactada — ${bizName(contactedTarget)}`} onClose={() => setContactedTarget(null)}>
          <form onSubmit={submitContacted} className="space-y-4">
            <FormError message={contactedError} />
            <p className="text-xs text-slate-400">
              {cityName(contactedTarget)} · {catName(contactedTarget)} · estado actual: {INVITATION_STATUS_LABELS[contactedTarget.status]}
            </p>
            <Field label="Meio de contacto (obrigatório)">
              <Select value={contactedMethod} onChange={(e) => setContactedMethod(e.target.value as InvitationContactMethod | '')} required>
                <option value="" className="bg-navy-900">— Escolher —</option>
                {METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m} className="bg-navy-900">{INVITATION_CONTACT_METHOD_LABELS[m]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Pessoa contactada (opcional)" hint="Uso interno — nunca público.">
              <TextInput value={contactedPerson} onChange={(e) => setContactedPerson(e.target.value)} placeholder="Ex.: Ana Silva (gerência)" />
            </Field>
            <Field label="Notas internas (opcional)" hint="Uso interno — nunca público.">
              <TextArea value={contactedNotes} onChange={(e) => setContactedNotes(e.target.value)} rows={3} placeholder="Ex.: ligou-se às 10h, pediu para reenviar por e-mail" />
            </Field>
            <FormActions onCancel={() => setContactedTarget(null)} saving={actingId === contactedTarget.id} saveLabel="Confirmar contacto" />
          </form>
        </Modal>
      )}

      {/* FASE 6.1.1 — modal Marcar como Aceitou */}
      {acceptedTarget && (
        <Modal title={`Marcar como Aceitou — ${bizName(acceptedTarget)}`} onClose={() => setAcceptedTarget(null)}>
          <form onSubmit={submitAccepted} className="space-y-4">
            <FormError message={acceptedError} />
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] leading-relaxed text-emerald-100">
              A participação na votação é gratuita e a aceitação não implica qualquer obrigação de compra.
            </div>
            <p className="text-xs text-slate-400">
              Contacto registado: {contactMethodLabel(acceptedTarget.contact_method)}
              {acceptedTarget.contact_person ? ` · ${acceptedTarget.contact_person}` : ''} · contactada em {formatDateTime(acceptedTarget.contacted_at)}
            </p>
            <Field label="Referência da aceitação (opcional)" hint="Ex.: Confirmação recebida por WhatsApp / por e-mail / Aceitação verbal por telefone.">
              <TextInput value={acceptedReference} onChange={(e) => setAcceptedReference(e.target.value)} placeholder="Confirmação recebida por WhatsApp" />
            </Field>
            <Field label="Notas internas adicionais (opcional)" hint="Anexadas ao histórico existente sem apagar nada. Uso interno.">
              <TextArea value={acceptedNotes} onChange={(e) => setAcceptedNotes(e.target.value)} rows={3} placeholder="Ex.: aceitou participar na edição actual, prefere contacto por e-mail" />
            </Field>
            <FormActions onCancel={() => setAcceptedTarget(null)} saving={actingId === acceptedTarget.id} saveLabel="Confirmar aceitação" />
          </form>
        </Modal>
      )}

      {/* FASE 6.1.1 — modal Confirmar para votação (substitui window.confirm) */}
      {confirmTarget && (
        <Modal title="Confirmar esta empresa para votação?" onClose={() => setConfirmTarget(null)}>
          <div className="space-y-4">
            <FormError message={confirmError} />
            <p className="text-sm font-medium text-white">{bizName(confirmTarget)}</p>
            <p className="text-sm leading-relaxed text-slate-300">
              Esta ação cria ou associa a participação efetiva na campanha. A empresa ficará confirmada para esta edição.
            </p>
            <p className="text-xs text-slate-500">
              {cityName(confirmTarget)} · {catName(confirmTarget)} · aceitação em {formatDateTime(confirmTarget.accepted_at)}
              {confirmTarget.acceptance_reference ? ` · ref.: ${confirmTarget.acceptance_reference}` : ''} · idempotente: se já existir entry compatível, reutiliza sem duplicar.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitConfirm}
                disabled={actingId === confirmTarget.id}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {actingId === confirmTarget.id ? 'A confirmar…' : 'Confirmar para votação'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Gerir convite — ${bizName(detail)}`} onClose={() => setDetail(null)} wide>
          <div className="space-y-4">
            <FormError message={manageError ?? actionError} />
            <div className="flex flex-wrap items-center gap-2">
              {statusPill(detail.status)}
              <span className="text-xs text-slate-500">
                {cityName(detail)} · {catName(detail)} · contacto: {contactMethodLabel(detail.contact_method)}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Meio de contacto">
                <Select value={methodDraft} onChange={(e) => setMethodDraft(e.target.value as InvitationContactMethod | '')}>
                  <option value="" className="bg-navy-900">—</option>
                  {METHOD_OPTIONS.map((m) => (
                    <option key={m} value={m} className="bg-navy-900">{INVITATION_CONTACT_METHOD_LABELS[m]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Pessoa contactada (interno)">
                <TextInput value={personDraft} onChange={(e) => setPersonDraft(e.target.value)} placeholder="Quem falou com a empresa" />
              </Field>
            </div>
            <Field label="Referência da aceitação (interno)" hint="Texto simples, sem ficheiros. Ex.: Confirmação recebida por WhatsApp.">
              <TextInput value={acceptanceDraft} onChange={(e) => setAcceptanceDraft(e.target.value)} placeholder="Confirmação recebida por e-mail" />
            </Field>
            <Field label="Notas internas (nunca públicas)">
              <TextArea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={3} />
            </Field>
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-400 sm:grid-cols-2">
              <p><span className="text-slate-500">Contactada em:</span> {formatDateTime(detail.contacted_at)}</p>
              <p><span className="text-slate-500">Aceite em:</span> {formatDateTime(detail.accepted_at)}</p>
              <p><span className="text-slate-500">Recusada em:</span> {formatDateTime(detail.declined_at)}</p>
              <p><span className="text-slate-500">Confirmada em:</span> {formatDateTime(detail.confirmed_at)}</p>
              <p><span className="text-slate-500">Criado em:</span> {formatDateTime(detail.created_at)}</p>
              <p><span className="text-slate-500">Actualizado em:</span> {formatDateTime(detail.updated_at)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => saveManage(detail)}
                disabled={actingId === detail.id}
                className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
              >
                Guardar dados internos
              </button>
              {canTransition(detail.status, 'contacted') && (
                <button
                  onClick={() => { setDetail({ ...detail, contact_method: methodDraft ? (methodDraft as InvitationContactMethod) : detail.contact_method }); openContactedModal(detail); }}
                  disabled={actingId === detail.id}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/30 px-4 py-2 text-sm text-sky-200 hover:bg-sky-500/10 disabled:opacity-40"
                >
                  <RefreshCcw className="h-3.5 w-3.5" /> Contactada
                </button>
              )}
              {canTransition(detail.status, 'accepted') && (
                <button
                  onClick={() => { openAcceptedModal(detail); }}
                  disabled={actingId === detail.id}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> Aceitou
                </button>
              )}
              {canTransition(detail.status, 'confirmed') && (
                <button
                  onClick={() => openConfirmModal(detail)}
                  disabled={actingId === detail.id}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gold-gradient px-4 py-2 text-sm font-semibold text-navy-950 hover:brightness-110 disabled:opacity-40"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar para votação
                </button>
              )}
              {canTransition(detail.status, 'declined') && (
                <button
                  onClick={() => runTransition(detail, 'declined')}
                  disabled={actingId === detail.id}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> Recusou
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Auditoria: {Object.values(INVITATION_AUDIT_ACTIONS).join(' · ')} em audit_logs (trigger best-effort + escrita aplicacional).
              {detail.campaign_entry_id ? ` Entry associada: ${detail.campaign_entry_id.slice(0, 8)}…` : ' Sem entry — contactar/aceitar nunca cria entry.'}
              {' '}Dados internos nunca são públicos.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
