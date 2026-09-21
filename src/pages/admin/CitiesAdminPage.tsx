/**
 * THE BEST EUROPA — FASE 5C.3.7 — Admin > Cidades (isolado por programa).
 *
 * Scope: cities.country_code = país do programa selecionado
 * (AdminProgramProvider — única fonte). FAIL-CLOSED: sem programa válido
 * → sem dados, sem fallback silencioso. Criação deriva country_code do
 * programa; edição NUNCA muda o país (cidades existentes intactas).
 */
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useScopedCities } from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { slugify } from '../../lib/utils';
import type { City } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Toggle, Modal, FormError, FormActions, ImageField } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface CityFormState {
  name: string;
  slug: string;
  district: string;
  description: string;
  image_url: string;
  active: boolean;
}

const emptyForm: CityFormState = { name: '', slug: '', district: '', description: '', image_url: '', active: true };

export default function CitiesAdminPage() {
  const { selectedProgram, selectedProgramId } = useAdminProgram();
  const countryCode = selectedProgram?.country_code ?? null;
  const query = useScopedCities(countryCode);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; city: City } | null>(null);
  const [form, setForm] = useState<CityFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId && countryCode);

  function openCreate() {
    setForm(emptyForm);
    setFormError(null);
    setModal({ mode: 'create' });
  }

  function openEdit(city: City) {
    setForm({
      name: city.name,
      slug: city.slug,
      district: city.district ?? '',
      description: city.description ?? '',
      image_url: city.image_url ?? '',
      active: city.active,
    });
    setFormError(null);
    setModal({ mode: 'edit', city });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    // FAIL-CLOSED: sem programa válido, sem escrita.
    if (!hasProgram || !countryCode) {
      setFormError('Sem programa válido — fail-closed: selecione um programa no seletor global antes de criar cidades.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Nome e slug são obrigatórios.');
      return;
    }
    // Defesa: edição nunca muda o país de uma cidade existente.
    if (modal && 'city' in modal) {
      const existingCountry = (modal.city.country_code ?? null) as string | null;
      if (existingCountry && existingCountry !== countryCode) {
        setFormError(`Esta cidade pertence a outro país (${existingCountry}) — edição recusada neste programa.`);
        return;
      }
    }
    setSaving(true);
    try {
      if (modal && 'city' in modal) {
        const payload = {
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          district: form.district.trim() || null,
          description: form.description.trim() || null,
          image_url: form.image_url.trim() || null,
          active: form.active,
        };
        const { error } = await supabase.from('cities').update(payload).eq('id', modal.city.id);
        if (error) throw error;
        await audit('city.update', 'cities', modal.city.id, { name: payload.name });
      } else {
        // country_code DERIVADO do programa selecionado (nunca input livre).
        const payload = {
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          district: form.district.trim() || null,
          description: form.description.trim() || null,
          image_url: form.image_url.trim() || null,
          active: form.active,
          country_code: countryCode,
        };
        const { data, error } = await supabase.from('cities').insert(payload).select('id').single();
        if (error) throw error;
        await audit('city.create', 'cities', (data as { id: string }).id, { name: payload.name, country_code: countryCode });
      }
      setModal(null);
      query.refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao guardar a cidade.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(city: City) {
    if (!supabase) return;
    const { error } = await supabase.from('cities').update({ active: !city.active }).eq('id', city.id);
    if (!error) {
      await audit(city.active ? 'city.deactivate' : 'city.activate', 'cities', city.id, { name: city.name });
      query.refetch();
    }
  }

  if (query.loading) return <PageLoading label="A carregar cidades…" />;

  return (
    <div>
      <AdminHeader
        title="Cidades"
        description={`Localidades do programa ${selectedProgram ? `· ${selectedProgram.name} (${countryCode})` : '(sem programa válido)'}. Leitura pública limitada a cidades activas (policy RLS).`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured || !hasProgram}
            title={!hasProgram ? 'Selecione um programa válido primeiro' : isSupabaseConfigured ? 'Nova cidade' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova cidade
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma cidade é apresentada por fallback." onRetry={query.refetch} />
      ) : query.error && (query.data ?? []).length === 0 ? (
        <ErrorState message={query.error} onRetry={query.refetch} />
      ) : (
        <AdminCard title={`Cidades — ${countryCode} (${(query.data ?? []).length})`}>
          <AdminTable
            searchable
            searchKeys={['name', 'slug', 'district']}
            searchPlaceholder="Pesquisar cidades…"
            rows={(query.data ?? []).map((c) => ({ ...c }))}
            columns={[
              { key: 'name', label: 'Cidade', render: (r) => <span className="font-medium text-white">{String(r.name)}</span> },
              { key: 'slug', label: 'Slug', render: (r) => <code className="text-xs text-slate-400">{String(r.slug)}</code> },
              { key: 'district', label: 'Distrito', render: (r) => String(r.district ?? '—') },
              { key: 'country_code', label: 'País', render: (r) => <code className="text-xs text-gold-300">{String((r as unknown as City).country_code ?? countryCode ?? '—')}</code> },
              { key: 'active', label: 'Estado', render: (r) => <StatusPill active={Boolean(r.active)} /> },
              {
                key: 'actions', label: 'Acções',
                render: (r) => (
                  <span className="flex gap-2">
                    <button
                      onClick={() => openEdit(r as unknown as City)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => toggleActive(r as unknown as City)}
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
        <Modal title={modal.mode === 'create' ? `Nova cidade — ${countryCode ?? ''}` : `Editar — ${(modal as { city: City }).city.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormError message={formError} />
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              País da cidade: <strong className="text-gold-300">{countryCode}</strong> (derivado do programa <strong className="text-white">{selectedProgram?.name}</strong> — não editável).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value, slug: modal.mode === 'create' ? slugify(e.target.value) : form.slug })}
                  placeholder="Ex.: Braga"
                  required
                />
              </Field>
              <Field label="Slug" hint="Gerado automaticamente; único por cidade.">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="braga" required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Distrito">
                <TextInput value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="Ex.: Braga" />
              </Field>
              <ImageField
                label="Imagem da cidade"
                value={form.image_url}
                onChange={(url) => setForm({ ...form, image_url: url })}
                bucket="city-images"
                slugHint={form.slug || form.name}
                hint="Upload directo para o Storage (máx. 2 MB) ou URL manual."
              />
            </div>
            <Field label="Descrição">
              <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Texto de apresentação da cidade…" />
            </Field>
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Cidade activa (visível no sítio público)" />
            <FormActions onCancel={() => setModal(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}
