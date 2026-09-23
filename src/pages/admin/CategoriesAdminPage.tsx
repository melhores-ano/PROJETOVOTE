/**
 * THE BEST EUROPA — FASE 5C.3.7 → FASE 6.2 — Admin > Categorias (isolado por programa).
 *
 * Scope: categories.award_program_id = programa selecionado
 * (AdminProgramProvider — única fonte). FAIL-CLOSED: sem programa válido
 * → sem dados. Criação deriva award_program_id + locale do programa.
 * As 8 categorias existentes de Portugal NÃO são alteradas.
 *
 * FASE 6.2: campo opcional Área (categories.area_id → category_areas do
 * programa atual; NULL = "Sem área"). A categoria continua a ser a unidade
 * eleitoral real — category_id permanece a autoridade em campaign_entries,
 * votes e results. Área nunca recebe votos.
 */
import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useScopedCategories } from '../../hooks/useAdminData';
import { useScopedCategoryAreas } from '../../hooks/useCategoryAreas';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { slugify } from '../../lib/utils';
import type { Category } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Select, Toggle, Modal, FormError, FormActions } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

const ICON_OPTIONS = ['Scissors', 'UtensilsCrossed', 'Croissant', 'Coffee', 'Sparkles', 'Dumbbell', 'Store', 'BedDouble'];

interface CategoryFormState {
  name: string;
  slug: string;
  description: string;
  icon: string;
  /** FASE 6.2: área do programa atual; '' = Sem área (area_id NULL). */
  area_id: string;
  active: boolean;
}

const emptyForm: CategoryFormState = { name: '', slug: '', description: '', icon: 'Store', area_id: '', active: true };

export default function CategoriesAdminPage() {
  const { selectedProgram, selectedProgramId } = useAdminProgram();
  const query = useScopedCategories(selectedProgramId);
  const areasQuery = useScopedCategoryAreas(selectedProgramId);
  const areas = useMemo(() => areasQuery.data ?? [], [areasQuery.data]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; category: Category } | null>(null);
  const [form, setForm] = useState<CategoryFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId);

  function openCreate() {
    setForm(emptyForm);
    setFormError(null);
    setModal({ mode: 'create' });
  }

  function openEdit(category: Category) {
    setForm({
      name: category.name,
      slug: category.slug,
      description: category.description ?? '',
      icon: category.icon ?? 'Store',
      area_id: category.area_id ?? '',
      active: category.active,
    });
    setFormError(null);
    setModal({ mode: 'edit', category });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    // FAIL-CLOSED: sem programa válido, sem escrita.
    if (!hasProgram || !selectedProgramId) {
      setFormError('Sem programa válido — fail-closed: selecione um programa no seletor global antes de criar categorias.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Nome e slug são obrigatórios.');
      return;
    }
    // Defesa: categoria de outro programa nunca é editada aqui.
    if (modal && 'category' in modal) {
      const owner = (modal.category.award_program_id ?? null) as string | null;
      if (owner && owner !== selectedProgramId) {
        setFormError('Esta categoria pertence a outro programa — edição recusada.');
        return;
      }
    }
    // FASE 6.2: área tem de pertencer ao programa atual (ou Sem área).
    if (form.area_id) {
      const area = areaById.get(form.area_id);
      if (!area) {
        setFormError('Área inválida — selecione uma área do programa atual ou "Sem área".');
        return;
      }
      if (area.award_program_id !== selectedProgramId) {
        setFormError('Esta área pertence a outro programa — associação recusada.');
        return;
      }
    }
    setSaving(true);
    try {
      if (modal && 'category' in modal) {
        const payload = {
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          description: form.description.trim() || null,
          icon: form.icon,
          // FASE 6.2: NULL = "Sem área" (categorias antigas preservadas).
          area_id: form.area_id || null,
          active: form.active,
        };
        const { error } = await supabase.from('categories').update(payload).eq('id', modal.category.id);
        if (error) throw error;
        await audit('category.update', 'categories', modal.category.id, { name: payload.name });
      } else {
        // award_program_id + locale DERIVADOS do programa selecionado.
        const payload = {
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          description: form.description.trim() || null,
          icon: form.icon,
          // FASE 6.2: NULL = "Sem área".
          area_id: form.area_id || null,
          active: form.active,
          award_program_id: selectedProgramId,
          locale: selectedProgram?.locale ?? null,
        };
        const { data, error } = await supabase.from('categories').insert(payload).select('id').single();
        if (error) throw error;
        await audit('category.create', 'categories', (data as { id: string }).id, { name: payload.name, award_program_id: selectedProgramId });
      }
      setModal(null);
      query.refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao guardar a categoria.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(category: Category) {
    if (!supabase) return;
    const { error } = await supabase.from('categories').update({ active: !category.active }).eq('id', category.id);
    if (!error) {
      await audit(category.active ? 'category.deactivate' : 'category.activate', 'categories', category.id, { name: category.name });
      query.refetch();
    }
  }

  if (query.loading) return <PageLoading label="A carregar categorias…" />;

  return (
    <div>
      <AdminHeader
        title="Categorias"
        description={`Categorias do programa ${selectedProgram ? `· ${selectedProgram.name}` : '(sem programa válido)'}. O campo icon referencia um ícone lucide-react.`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured || !hasProgram}
            title={!hasProgram ? 'Selecione um programa válido primeiro' : isSupabaseConfigured ? 'Nova categoria' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova categoria
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma categoria é apresentada por fallback." onRetry={query.refetch} />
      ) : query.error && (query.data ?? []).length === 0 ? (
        <ErrorState message={query.error} onRetry={query.refetch} />
      ) : (
        <AdminCard title={`Categorias — ${selectedProgram?.name} (${(query.data ?? []).length})`}>
          <AdminTable
            searchable
            searchKeys={['name', 'slug']}
            searchPlaceholder="Pesquisar categorias…"
            rows={(query.data ?? []).map((c) => ({ ...c }))}
            columns={[
              { key: 'name', label: 'Categoria', render: (r) => <span className="font-medium text-white">{String(r.name)}</span> },
              { key: 'slug', label: 'Slug', render: (r) => <code className="text-xs text-slate-400">{String(r.slug)}</code> },
              {
                key: 'area_id',
                label: 'Área',
                render: (r) => {
                  const areaId = (r as unknown as Category).area_id ?? null;
                  const area = areaId ? areaById.get(areaId) : undefined;
                  if (!areaId) return <span className="text-xs text-slate-500">Sem área</span>;
                  if (!area) return <code className="text-xs text-amber-300">área desconhecida</code>;
                  return <span className="text-xs text-gold-300">{area.name}</span>;
                },
              },
              { key: 'locale', label: 'Locale', render: (r) => <code className="text-xs text-slate-400">{String((r as unknown as Category).locale ?? '—')}</code> },
              { key: 'icon', label: 'Ícone', render: (r) => <code className="text-xs text-gold-300">{String((r as unknown as Category).icon ?? '—')}</code> },
              { key: 'active', label: 'Estado', render: (r) => <StatusPill active={Boolean(r.active)} /> },
              {
                key: 'actions', label: 'Acções',
                render: (r) => (
                  <span className="flex gap-2">
                    <button
                      onClick={() => openEdit(r as unknown as Category)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => toggleActive(r as unknown as Category)}
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
        </AdminCard>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? `Nova categoria — ${selectedProgram?.name ?? ''}` : `Editar — ${(modal as { category: Category }).category.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormError message={formError} />
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              Programa: <strong className="text-white">{selectedProgram?.name}</strong>
              {selectedProgram?.locale ? <> · locale <strong className="text-gold-300">{selectedProgram.locale}</strong></> : null} (atribuídos automaticamente).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value, slug: modal.mode === 'create' ? slugify(e.target.value) : form.slug })}
                  placeholder="Ex.: Barbearias"
                  required
                />
              </Field>
              <Field label="Slug">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="barbearias" required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ícone (lucide-react)">
                <Select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                  {ICON_OPTIONS.map((icon) => (
                    <option key={icon} value={icon} className="bg-navy-900">{icon}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Área (opcional)">
                <Select value={form.area_id} onChange={(e) => setForm({ ...form, area_id: e.target.value })}>
                  <option value="" className="bg-navy-900">Sem área</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id} className="bg-navy-900">{a.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex items-end pb-0.5">
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Categoria activa" />
            </div>
            <Field label="Descrição">
              <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Descrição curta da categoria…" />
            </Field>
            <FormActions onCancel={() => setModal(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}
