/**
 * THE BEST EUROPA — FASE 5C.3.8 — Admin > Modalidades (isolado por programa).
 *
 * Fundação de dados das modalidades de distinção (Categoria → Modalidades).
 * Scope: award_modalities.award_program_id = programa selecionado
 * (AdminProgramProvider — única fonte). FAIL-CLOSED: sem programa válido
 * → sem dados, sem escrita. Criação deriva award_program_id do contexto;
 * categorias disponíveis SOMENTE do programa atual (nunca de outro programa).
 *
 * REGRA INEGOCIÁVEL: resultado eleitoral e adesão comercial são coisas
 * diferentes. Esta página gere DEFINIÇÕES de modalidades — não toca em
 * votes / vote_attempts / vote_adjustments / RPCs de apuramento.
 * SEM seeds: nenhuma modalidade é criada automaticamente.
 */
import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useScopedCategories, useScopedDistinctions, useScopedModalities } from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { slugify } from '../../lib/utils';
import type { AwardModality, Category } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Select, Toggle, Modal, FormError, FormActions } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

const ICON_SUGGESTIONS = ['Award', 'Star', 'Sparkles', 'HeartHandshake', 'UtensilsCrossed', 'Coffee', 'Medal', 'Crown'];

interface ModalityFormState {
  category_id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  position: number;
  active: boolean;
}

const emptyForm: ModalityFormState = {
  category_id: '',
  name: '',
  slug: '',
  description: '',
  icon: 'Award',
  position: 0,
  active: true,
};

export default function ModalitiesAdminPage() {
  const { selectedProgram, selectedProgramId, selectedCampaign, selectedCampaignId } = useAdminProgram();
  const categoriesQuery = useScopedCategories(selectedProgramId);
  const modalitiesQuery = useScopedModalities(selectedProgramId);
  const distinctionsQuery = useScopedDistinctions(selectedCampaignId, selectedProgramId);

  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; modality: AwardModality } | null>(null);
  const [form, setForm] = useState<ModalityFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const distinctionsByModality = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of distinctionsQuery.data ?? []) {
      map.set(d.modality_id, (map.get(d.modality_id) ?? 0) + 1);
    }
    return map;
  }, [distinctionsQuery.data]);

  const filtered = useMemo(() => {
    let rows = modalitiesQuery.data ?? [];
    if (categoryFilter !== 'all') rows = rows.filter((m) => m.category_id === categoryFilter);
    if (statusFilter === 'active') rows = rows.filter((m) => m.active);
    if (statusFilter === 'inactive') rows = rows.filter((m) => !m.active);
    return rows;
  }, [modalitiesQuery.data, categoryFilter, statusFilter]);

  function openCreate() {
    setForm({ ...emptyForm, category_id: categoryFilter !== 'all' ? categoryFilter : '' });
    setFormError(null);
    setModal({ mode: 'create' });
  }

  function openEdit(modality: AwardModality) {
    setForm({
      category_id: modality.category_id,
      name: modality.name,
      slug: modality.slug,
      description: modality.description ?? '',
      icon: modality.icon ?? 'Award',
      position: modality.position ?? 0,
      active: modality.active,
    });
    setFormError(null);
    setModal({ mode: 'edit', modality });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    if (!hasProgram || !selectedProgramId) {
      setFormError('Sem programa válido — fail-closed: selecione um programa no seletor global antes de criar modalidades.');
      return;
    }
    if (!form.category_id) {
      setFormError('Selecione uma categoria do programa atual.');
      return;
    }
    // Defesa: categoria de outro programa nunca é aceite.
    const chosen = categoryById.get(form.category_id);
    if (!chosen || (chosen.award_program_id ?? null) !== selectedProgramId) {
      setFormError('Esta categoria não pertence ao programa selecionado — criação recusada.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Nome e slug são obrigatórios.');
      return;
    }
    if (modal && 'modality' in modal && modal.modality.award_program_id !== selectedProgramId) {
      setFormError('Esta modalidade pertence a outro programa — edição recusada.');
      return;
    }
    setSaving(true);
    try {
      if (modal && 'modality' in modal) {
        const payload = {
          // award_program_id NUNCA editável manualmente: deriva-se da categoria.
          category_id: form.category_id,
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          description: form.description.trim() || null,
          icon: form.icon.trim() || null,
          position: Math.trunc(Number(form.position)) || 0,
          active: form.active,
        };
        const { error } = await supabase.from('award_modalities').update(payload).eq('id', modal.modality.id);
        if (error) throw error;
        await audit('award_modality.update', 'award_modalities', modal.modality.id, {
          name: payload.name,
          category_id: payload.category_id,
          award_program_id: selectedProgramId,
        });
      } else {
        // award_program_id DERIVADO do contexto (nunca input manual).
        const payload = {
          award_program_id: selectedProgramId,
          category_id: form.category_id,
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          description: form.description.trim() || null,
          icon: form.icon.trim() || null,
          position: Math.trunc(Number(form.position)) || 0,
          active: form.active,
        };
        const { data, error } = await supabase.from('award_modalities').insert(payload).select('id').single();
        if (error) throw error;
        await audit('award_modality.create', 'award_modalities', (data as { id: string }).id, {
          name: payload.name,
          category_id: payload.category_id,
          award_program_id: selectedProgramId,
        });
      }
      setModal(null);
      modalitiesQuery.refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao guardar a modalidade.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(modality: AwardModality) {
    if (!supabase) return;
    if (modality.award_program_id !== selectedProgramId) return;
    const { error } = await supabase.from('award_modalities').update({ active: !modality.active }).eq('id', modality.id);
    if (!error) {
      await audit(modality.active ? 'award_modality.deactivate' : 'award_modality.activate', 'award_modalities', modality.id, {
        name: modality.name,
        award_program_id: selectedProgramId,
      });
      modalitiesQuery.refetch();
    }
  }

  if (modalitiesQuery.loading || categoriesQuery.loading) return <PageLoading label="A carregar modalidades…" />;

  return (
    <div>
      <AdminHeader
        title="Modalidades"
        description={`Distinções por categoria do programa ${selectedProgram ? `· ${selectedProgram.name}` : '(sem programa válido)'}. Definições administrativas — não alteram o resultado oficial da votação.`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured || !hasProgram}
            title={!hasProgram ? 'Selecione um programa válido primeiro' : isSupabaseConfigured ? 'Nova modalidade' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova modalidade
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma modalidade é apresentada por fallback." onRetry={modalitiesQuery.refetch} />
      ) : modalitiesQuery.error && filtered.length === 0 ? (
        <ErrorState message={modalitiesQuery.error} onRetry={modalitiesQuery.refetch} />
      ) : (
        <>
          <AdminCard title={`Filtros — ${selectedProgram?.name}`}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Categoria">
                <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Estado">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todas</option>
                  <option value="active" className="bg-navy-900">Ativas</option>
                  <option value="inactive" className="bg-navy-900">Inativas</option>
                </Select>
              </Field>
              <Field label="Pesquisa">
                <p className="rounded-xl border border-white/10 bg-navy-950/60 px-4 py-2.5 text-xs text-slate-500">
                  Use a pesquisa da tabela abaixo (nome / slug).
                </p>
              </Field>
            </div>
          </AdminCard>
          <div className="mt-4">
            <AdminCard title={`Modalidades — ${selectedProgram?.name} (${filtered.length})`}>
              <AdminTable
                searchable
                searchKeys={['name', 'slug']}
                searchPlaceholder="Pesquisar modalidades…"
                rows={filtered.map((m) => ({ ...m }))}
                columns={[
                  {
                    key: 'name',
                    label: 'Modalidade',
                    render: (r) => (
                      <span>
                        <span className="block font-medium text-white">{String(r.name)}</span>
                        <span className="block text-xs text-slate-500">
                          {(categoryById.get(String((r as unknown as AwardModality).category_id))?.name ?? '—')}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'category_id',
                    label: 'Categoria',
                    render: (r) => <span className="text-xs text-slate-300">{categoryById.get(String((r as unknown as AwardModality).category_id))?.name ?? '—'}</span>,
                  },
                  { key: 'slug', label: 'Slug', render: (r) => <code className="text-xs text-slate-400">{String(r.slug)}</code> },
                  { key: 'position', label: 'Posição', render: (r) => <span className="text-xs text-slate-300">{String(r.position ?? 0)}</span> },
                  {
                    key: 'distinctions',
                    label: 'Distinções (edição atual)',
                    render: (r) => (
                      <span className="text-xs text-slate-400" title={selectedCampaign ? `Edição ${selectedCampaign.year} — ${selectedCampaign.name}` : 'Sem edição selecionada'}>
                        {distinctionsByModality.get(String((r as unknown as AwardModality).id)) ?? 0}
                      </span>
                    ),
                  },
                  { key: 'active', label: 'Estado', render: (r) => <StatusPill active={Boolean(r.active)} /> },
                  {
                    key: 'actions',
                    label: 'Acções',
                    render: (r) => (
                      <span className="flex gap-2">
                        <button
                          onClick={() => openEdit(r as unknown as AwardModality)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                        >
                          <Pencil className="h-3 w-3" /> Editar
                        </button>
                        <button
                          onClick={() => toggleActive(r as unknown as AwardModality)}
                          disabled={!isSupabaseConfigured}
                          className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                        >
                          {Boolean(r.active) ? 'Desactivar' : 'Activar'}
                        </button>
                      </span>
                    ),
                  },
                ]}
              />
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                O resultado oficial da votação permanece intocável: ativar/desativar uma modalidade nunca transfere
                lugares, nunca altera votos e nunca modifica ajustes administrativos.
              </p>
            </AdminCard>
          </div>
        </>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? `Nova modalidade — ${selectedProgram?.name ?? ''}` : `Editar — ${(modal as { modality: AwardModality }).modality.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormError message={formError} />
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              Programa: <strong className="text-white">{selectedProgram?.name}</strong> (atribuído automaticamente —
              sem seleção manual de programa).
            </p>
            <Field label="Categoria (somente do programa atual)">
              <Select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                required
              >
                <option value="" className="bg-navy-900">Selecionar categoria…</option>
                {categories.map((c: Category) => (
                  <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value, slug: modal.mode === 'create' ? slugify(e.target.value) : form.slug })}
                  placeholder="Ex.: Excelência no Atendimento"
                  required
                />
              </Field>
              <Field label="Slug">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="excelencia-no-atendimento" required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ícone (lucide-react)">
                <Select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                  {ICON_SUGGESTIONS.map((icon) => (
                    <option key={icon} value={icon} className="bg-navy-900">{icon}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Posição (ordenação)">
                <TextInput
                  type="number"
                  value={String(form.position)}
                  onChange={(e) => setForm({ ...form, position: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Descrição">
              <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Descrição curta da modalidade…" />
            </Field>
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Modalidade activa" />
            <FormActions onCancel={() => setModal(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}
