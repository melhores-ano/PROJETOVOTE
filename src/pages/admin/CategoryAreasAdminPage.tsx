/**
 * THE BEST EUROPA — FASE 6.2 — Admin > Áreas (isolado por programa).
 *
 * Gere category_areas (agrupador/navegação ÁREA → CATEGORIA → EMPRESAS).
 * Scope: category_areas.award_program_id = programa selecionado
 * (AdminProgramProvider — única fonte). FAIL-CLOSED: sem programa válido
 * → sem dados, sem escrita. Criação deriva award_program_id + locale do
 * programa. Áreas de outro programa nunca visíveis/editáveis aqui.
 *
 * REGRA INEGOCIÁVEL: Área é SOMENTE navegação — NÃO recebe votos, NÃO
 * recebe campaign_entry, NUNCA aparece como category_id. Esta página NÃO
 * toca em votes / vote_attempts / vote_adjustments / modality_votes /
 * RPCs de apuramento. SEM seeds: nenhuma área é criada automaticamente.
 */
import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useScopedCategoryAreas } from '../../hooks/useCategoryAreas';
import { useScopedCategories } from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { slugify } from '../../lib/utils';
import type { CategoryArea } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Toggle, Modal, FormError, FormActions } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface AreaFormState {
  name: string;
  slug: string;
  description: string;
  locale: string;
  sort_order: number;
  active: boolean;
}

const emptyForm: AreaFormState = { name: '', slug: '', description: '', locale: '', sort_order: 0, active: true };

export default function CategoryAreasAdminPage() {
  const { selectedProgram, selectedProgramId } = useAdminProgram();
  const query = useScopedCategoryAreas(selectedProgramId);
  const categoriesQuery = useScopedCategories(selectedProgramId);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; area: CategoryArea } | null>(null);
  const [form, setForm] = useState<AreaFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId);

  const countByArea = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of categoriesQuery.data ?? []) {
      const areaId = c.area_id ?? null;
      if (areaId) map.set(areaId, (map.get(areaId) ?? 0) + 1);
    }
    return map;
  }, [categoriesQuery.data]);

  function openCreate() {
    setForm({ ...emptyForm, locale: selectedProgram?.locale ?? '' });
    setFormError(null);
    setModal({ mode: 'create' });
  }

  function openEdit(area: CategoryArea) {
    setForm({
      name: area.name,
      slug: area.slug,
      description: area.description ?? '',
      locale: area.locale ?? '',
      sort_order: area.sort_order ?? 0,
      active: area.active,
    });
    setFormError(null);
    setModal({ mode: 'edit', area });
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
      setFormError('Sem programa válido — fail-closed: selecione um programa no seletor global antes de criar áreas.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Nome e slug são obrigatórios.');
      return;
    }
    if (!Number.isInteger(form.sort_order)) {
      setFormError('Ordem (sort_order) deve ser um número inteiro.');
      return;
    }
    // Defesa: área de outro programa nunca é editada aqui.
    if (modal && 'area' in modal) {
      const owner = (modal.area.award_program_id ?? null) as string | null;
      if (owner && owner !== selectedProgramId) {
        setFormError('Esta área pertence a outro programa — edição recusada.');
        return;
      }
    }
    setSaving(true);
    try {
      if (modal && 'area' in modal) {
        const payload = {
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          description: form.description.trim() || null,
          locale: form.locale.trim() || null,
          sort_order: form.sort_order,
          active: form.active,
        };
        const { error } = await supabase.from('category_areas').update(payload).eq('id', modal.area.id);
        if (error) throw error;
        await audit('category_area.update', 'category_areas', modal.area.id, { name: payload.name });
      } else {
        // award_program_id DERIVADO do programa selecionado (nunca editável).
        const payload = {
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          description: form.description.trim() || null,
          locale: form.locale.trim() || selectedProgram?.locale || null,
          sort_order: form.sort_order,
          active: form.active,
          award_program_id: selectedProgramId,
        };
        const { data, error } = await supabase.from('category_areas').insert(payload).select('id').single();
        if (error) throw error;
        await audit('category_area.create', 'category_areas', (data as { id: string }).id, { name: payload.name, award_program_id: selectedProgramId });
      }
      setModal(null);
      query.refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao guardar a área.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(area: CategoryArea) {
    if (!supabase) return;
    const { error } = await supabase.from('category_areas').update({ active: !area.active }).eq('id', area.id);
    if (!error) {
      await audit(area.active ? 'category_area.deactivate' : 'category_area.activate', 'category_areas', area.id, { name: area.name });
      query.refetch();
    }
  }

  if (query.loading) return <PageLoading label="A carregar áreas…" />;

  return (
    <div>
      <AdminHeader
        title="Áreas"
        description={`Agrupadores de navegação do programa ${selectedProgram ? `· ${selectedProgram.name}` : '(sem programa válido)'}. Área é SOMENTE navegação (ÁREA → CATEGORIA → EMPRESAS) — nunca recebe votos.`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured || !hasProgram}
            title={!hasProgram ? 'Selecione um programa válido primeiro' : isSupabaseConfigured ? 'Nova área' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova área
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma área é apresentada por fallback." onRetry={query.refetch} />
      ) : query.error && (query.data ?? []).length === 0 ? (
        <ErrorState message={query.error} onRetry={query.refetch} />
      ) : (
        <AdminCard title={`Áreas — ${selectedProgram?.name} (${(query.data ?? []).length})`}>
          <AdminTable
            searchable
            searchKeys={['name', 'slug']}
            searchPlaceholder="Pesquisar áreas…"
            rows={(query.data ?? []).map((a) => ({ ...a }))}
            columns={[
              { key: 'sort_order', label: 'Ordem', render: (r) => <code className="text-xs text-slate-400">{String(r.sort_order ?? 0)}</code> },
              { key: 'name', label: 'Área', render: (r) => <span className="font-medium text-white">{String(r.name)}</span> },
              { key: 'slug', label: 'Slug', render: (r) => <code className="text-xs text-slate-400">{String(r.slug)}</code> },
              { key: 'locale', label: 'Locale', render: (r) => <code className="text-xs text-slate-400">{String((r as unknown as CategoryArea).locale ?? '—')}</code> },
              {
                key: 'categories',
                label: 'Categorias',
                render: (r) => <span className="text-xs text-gold-300">{countByArea.get(String(r.id)) ?? 0}</span>,
              },
              { key: 'active', label: 'Estado', render: (r) => <StatusPill active={Boolean(r.active)} /> },
              {
                key: 'actions', label: 'Acções',
                render: (r) => (
                  <span className="flex gap-2">
                    <button
                      onClick={() => openEdit(r as unknown as CategoryArea)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => toggleActive(r as unknown as CategoryArea)}
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
        <Modal title={modal.mode === 'create' ? `Nova área — ${selectedProgram?.name ?? ''}` : `Editar — ${(modal as { area: CategoryArea }).area.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormError message={formError} />
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              Programa: <strong className="text-white">{selectedProgram?.name}</strong> (atribuído automaticamente; áreas nunca cruzam programas).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value, slug: modal.mode === 'create' ? slugify(e.target.value) : form.slug })}
                  placeholder="Ex.: Restauração & Gastronomia"
                  required
                />
              </Field>
              <Field label="Slug">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="restauracao-gastronomia" required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Locale (opcional)">
                <TextInput value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} placeholder="pt-PT" />
              </Field>
              <Field label="Ordem (sort_order)">
                <TextInput
                  value={String(form.sort_order)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setForm({ ...form, sort_order: Number.isFinite(n) ? Math.trunc(n) : 0 });
                  }}
                  placeholder="0"
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="flex items-end pb-0.5">
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Área activa" />
            </div>
            <Field label="Descrição (opcional)">
              <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Descrição curta da área…" />
            </Field>
            <FormActions onCancel={() => setModal(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}
