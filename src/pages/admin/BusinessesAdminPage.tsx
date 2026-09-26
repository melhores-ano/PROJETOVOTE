/**
 * THE BEST EUROPA — FASE 5C.3.7 — Admin > Empresas (isolado por programa).
 *
 * Uma empresa pertence ao programa ATRAVÉS da sua cidade
 * (business.city.country_code = país do programa). Sem award_program_id
 * artificial em businesses (o schema não o exige).
 *
 * - Listagem: SOMENTE empresas cuja cidade pertence ao país do programa.
 * - Criação/edição: seletor de cidade lista SOMENTE cidades do programa;
 *   associação a cidade de outro programa é recusada (fail-closed).
 * - Empresa ≠ participação: a ligação empresa+edição+categoria continua
 *   em campaign_entries / Participantes. Mudar de edição nunca duplica.
 */
import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useScopedBusinesses, useScopedCategories, useScopedCities } from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { slugify, cn } from '../../lib/utils';
import type { Business } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Select, Toggle, Modal, FormError, FormActions, ImageField } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface BusinessFormState {
  name: string;
  slug: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  instagram: string;
  facebook: string;
  google_maps_url: string;
  logo_url: string;
  cover_url: string;
  city_id: string;
  category_ids: string[];
  active: boolean;
  verified: boolean;
}

const emptyForm: BusinessFormState = {
  name: '', slug: '', description: '', phone: '', email: '', address: '',
  website: '', instagram: '', facebook: '', google_maps_url: '',
  logo_url: '', cover_url: '',
  city_id: '', category_ids: [], active: true, verified: false,
};

const CREATE_DRAFT_PREFIX = 'the-best-europa:business-create-draft';

function createDraftKey(programId: string | null): string | null {
  return programId ? `${CREATE_DRAFT_PREFIX}:${programId}` : null;
}

function readCreateDraft(programId: string | null): Partial<BusinessFormState> | null {
  const key = createDraftKey(programId);
  if (!key) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed as Partial<BusinessFormState>;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function writeCreateDraft(programId: string | null, value: BusinessFormState): void {
  const key = createDraftKey(programId);
  if (!key) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // O rascunho nunca deve bloquear o formulário.
  }
}

function removeCreateDraft(programId: string | null): void {
  const key = createDraftKey(programId);
  if (!key) return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // O rascunho nunca deve bloquear o formulário.
  }
}
export default function BusinessesAdminPage() {
  const { selectedProgram, selectedProgramId } = useAdminProgram();
  const countryCode = selectedProgram?.country_code ?? null;
  // Listagem completa do programa (inclui inactivas para reactivação).
  const query = useScopedBusinesses(countryCode);
  const citiesQuery = useScopedCities(countryCode);
  const categoriesQuery = useScopedCategories(selectedProgramId);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; business: Business } | null>(null);
  const [form, setForm] = useState<BusinessFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId && countryCode);
  const cities = citiesQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const validCityIds = new Set(cities.map((c) => c.id));

  useEffect(() => {
    if (modal?.mode !== 'create' || !selectedProgramId) return;
    writeCreateDraft(selectedProgramId, form);
  }, [form, modal?.mode, selectedProgramId]);

  function openCreate() {
    const restored = readCreateDraft(selectedProgramId);

    setForm(
      restored
        ? { ...emptyForm, ...restored, city_id: restored.city_id ?? (cities[0]?.id ?? '') }
        : { ...emptyForm, city_id: cities[0]?.id ?? '' },
    );

    setFormError(null);
    setModal({ mode: 'create' });
  }

  function clearCreateDraft() {
    removeCreateDraft(selectedProgramId);
    setForm({ ...emptyForm, city_id: cities[0]?.id ?? '' });
    setFormError(null);
  }

  async function openEdit(business: Business) {
    setForm({
      name: business.name,
      slug: business.slug,
      description: business.description ?? '',
      phone: business.phone ?? '',
      email: business.email ?? '',
      address: business.address ?? '',
      website: business.website ?? '',
      instagram: business.instagram ?? '',
      facebook: business.facebook ?? '',
      google_maps_url: business.google_maps_url ?? '',
      logo_url: business.logo_url ?? '',
      cover_url: business.cover_url ?? '',
      city_id: business.city_id ?? '',
      category_ids: business.categories?.map((c) => c.id) ?? (await fetchLinkedCategories(business.id)),
      active: business.active,
      verified: business.verified,
    });
    setFormError(null);
    setModal({ mode: 'edit', business });
  }

  async function fetchLinkedCategories(businessId: string): Promise<string[]> {
    if (!supabase || businessId.startsWith('fb-') || businessId.startsWith('30000000')) return [];
    const { data } = await supabase.from('business_categories').select('category_id').eq('business_id', businessId);
    return ((data ?? []) as { category_id: string }[]).map((r) => r.category_id);
  }

  function toggleCategory(id: string) {
    setForm((f) => ({
      ...f,
      category_ids: f.category_ids.includes(id)
        ? f.category_ids.filter((c) => c !== id)
        : [...f.category_ids, id],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    if (!hasProgram || !countryCode) {
      setFormError('Sem programa válido — fail-closed: selecione um programa no seletor global antes de gerir empresas.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Nome e slug são obrigatórios.');
      return;
    }
    // FAIL-CLOSED geográfico: a cidade TEM de pertencer ao programa.
    if (!form.city_id || !validCityIds.has(form.city_id)) {
      setFormError(`Cidade inválida para o programa ${selectedProgram?.name} (${countryCode}) — escolha uma cidade listada. Empresas de outro país são recusadas.`);
      return;
    }
    // Categorias fora do programa nunca são ligadas.
    const scopedCategoryIds = form.category_ids.filter((id) => categories.some((c) => c.id === id));
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: slugify(form.slug.trim()),
        description: form.description.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        website: form.website.trim() || null,
        instagram: form.instagram.trim() || null,
        facebook: form.facebook.trim() || null,
        google_maps_url: form.google_maps_url.trim() || null,
        logo_url: form.logo_url.trim() || null,
        cover_url: form.cover_url.trim() || null,
        city_id: form.city_id || null,
        active: form.active,
        verified: form.verified,
      };
      let businessId: string;
      if (modal && 'business' in modal) {
        businessId = modal.business.id;
        const { error } = await supabase.from('businesses').update(payload).eq('id', businessId);
        if (error) throw error;
        await supabase.from('business_categories').delete().eq('business_id', businessId);
        await audit('business.update', 'businesses', businessId, { name: payload.name });
      } else {
        const { data, error } = await supabase.from('businesses').insert(payload).select('id').single();
        if (error) throw error;
        businessId = (data as { id: string }).id;
        await audit('business.create', 'businesses', businessId, { name: payload.name });
      }
      if (scopedCategoryIds.length > 0) {
        const { error } = await supabase
          .from('business_categories')
          .insert(scopedCategoryIds.map((category_id) => ({ business_id: businessId, category_id })));
        if (error) throw error;
      }
      if (modal?.mode === 'create') {
        removeCreateDraft(selectedProgramId);
      }
      setModal(null);
      query.refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao guardar a empresa.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(business: Business) {
    if (!supabase) return;
    const { error } = await supabase.from('businesses').update({ active: !business.active }).eq('id', business.id);
    if (!error) {
      await audit(business.active ? 'business.deactivate' : 'business.activate', 'businesses', business.id, { name: business.name });
      query.refetch();
    }
  }

  if (query.loading) return <PageLoading label="A carregar empresas…" />;

  return (
    <div>
      <AdminHeader
        title="Empresas"
        description={`Negócios do programa ${selectedProgram ? `· ${selectedProgram.name} (${countryCode})` : '(sem programa válido)'}. Empresa ≠ participação: a inscrição em edições faz-se em Participantes.`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured || !hasProgram}
            title={!hasProgram ? 'Selecione um programa válido primeiro' : isSupabaseConfigured ? 'Nova empresa' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova empresa
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma empresa é apresentada por fallback." onRetry={query.refetch} />
      ) : query.error && (query.data ?? []).length === 0 ? (
        <ErrorState message={query.error} onRetry={query.refetch} />
      ) : (
        <AdminCard title={`Empresas — ${selectedProgram?.name} (${(query.data ?? []).length})`}>
          <AdminTable
            searchable
            searchKeys={['name', 'slug', 'phone', 'email']}
            searchPlaceholder="Pesquisar empresas…"
            rows={(query.data ?? []).map((b) => ({ ...b }))}
            columns={[
              { key: 'name', label: 'Empresa', render: (r) => <span className="font-medium text-white">{String(r.name)}</span> },
              { key: 'slug', label: 'Slug', render: (r) => <code className="text-xs text-slate-400">{String(r.slug)}</code> },
              { key: 'city', label: 'Cidade', render: (r) => String((r as unknown as Business).city?.name ?? '—') },
              { key: 'phone', label: 'Telefone', render: (r) => String(r.phone ?? '—') },
              { key: 'verified', label: 'Verificada', render: (r) => <StatusPill active={Boolean(r.verified)} activeLabel="Verificada" inactiveLabel="Pendente" /> },
              { key: 'active', label: 'Estado', render: (r) => <StatusPill active={Boolean(r.active)} /> },
              {
                key: 'actions', label: 'Acções',
                render: (r) => (
                  <span className="flex gap-2">
                    <button
                      onClick={() => openEdit(r as unknown as Business)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => toggleActive(r as unknown as Business)}
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
        <Modal wide title={modal.mode === 'create' ? `Nova empresa — ${selectedProgram?.name ?? ''}` : `Editar — ${(modal as { business: Business }).business.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormError message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value, slug: modal.mode === 'create' ? slugify(e.target.value) : form.slug })}
                  placeholder="Ex.: Barbearia do Largo"
                  required
                />
              </Field>
              <Field label="Slug">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="barbearia-do-largo" required />
              </Field>
            </div>
            <Field label="Descrição">
              <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Apresentação do negócio…" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField
                label="Logótipo"
                value={form.logo_url}
                onChange={(url) => setForm({ ...form, logo_url: url })}
                bucket="business-logos"
                slugHint={`${form.slug || form.name}-logo`}
                hint="Máx. 2 MB."
              />
              <ImageField
                label="Imagem de capa"
                value={form.cover_url}
                onChange={(url) => setForm({ ...form, cover_url: url })}
                bucket="business-covers"
                slugHint={`${form.slug || form.name}-capa`}
                hint="Máx. 2 MB."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Cidade — somente ${countryCode}`} hint="Apenas cidades do programa selecionado.">
                <Select value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })}>
                  <option value="" className="bg-navy-900">— Escolher cidade —</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Morada">
                <TextInput value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Rua …, Cidade" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Telefone">
                <TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+351 …" inputMode="tel" />
              </Field>
              <Field label="Email">
                <TextInput value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="geral@negocio.pt" inputMode="email" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Website">
                <TextInput value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" inputMode="url" />
              </Field>
              <Field label="Google Maps (URL)">
                <TextInput value={form.google_maps_url} onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })} placeholder="https://maps…" inputMode="url" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Instagram">
                <TextInput value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="https://instagram.com/…" inputMode="url" />
              </Field>
              <Field label="Facebook">
                <TextInput value={form.facebook} onChange={(e) => setForm({ ...form, facebook: e.target.value })} placeholder="https://facebook.com/…" inputMode="url" />
              </Field>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Categorias do negócio — somente {selectedProgram?.name}</span>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const selected = form.category_ids.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      aria-pressed={selected}
                      className={cn(
                        'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition',
                        selected
                          ? 'border-gold-500/60 bg-gold-500/15 text-gold-200'
                          : 'border-white/15 bg-white/5 text-slate-400 hover:border-white/30 hover:text-white',
                      )}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {categories.length === 0 && (
                  <p className="text-xs text-slate-500">Sem categorias neste programa.</p>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Empresa activa" />
              <Toggle checked={form.verified} onChange={(v) => setForm({ ...form, verified: v })} label="Negócio verificado" />
            </div>
            {modal.mode === 'create' && (
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={clearCreateDraft}
                  className="text-xs text-slate-500 underline-offset-2 hover:text-gold-300 hover:underline"
                >
                  Limpar rascunho
                </button>
              </div>
            )}
            <FormActions onCancel={() => setModal(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}
