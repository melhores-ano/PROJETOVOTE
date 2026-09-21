import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ArrowUp, ArrowDown, Star, Trash2 } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import type { Business, Campaign, Category, City } from '../../types/database';
import { fallbackBusinesses, fallbackCampaign, fallbackCategories, fallbackCities } from '../../data/fallback';
import { useOptionalAdminProgram } from '../../hooks/useAdminProgram';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { Field, TextInput, Select, Toggle, Modal, FormError, FormActions } from '../../components/AdminForm';
import { PageLoading } from '../../components/ui';

interface EntryRow {
  id: string;
  campaign_id: string;
  campaign: string;
  city_id: string;
  city: string;
  category_id: string;
  category: string;
  business_id: string;
  business: string;
  featured: boolean;
  active: boolean;
  position: number;
}

interface EntryFormState {
  campaign_id: string;
  city_id: string;
  category_id: string;
  business_id: string;
  featured: boolean;
  position: number;
  active: boolean;
}

export default function EntriesAdminPage() {
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<EntryFormState>({
    campaign_id: '', city_id: '', category_id: '', business_id: '', featured: false, position: 0, active: true,
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [filterCampaign, setFilterCampaign] = useState('');
  // FASE 5C.3.6 — filtro de edição sincronizado com o contexto Admin.
  const adminCtx = useOptionalAdminProgram();
  const adminProgramId = adminCtx?.selectedProgramId ?? null;
  const adminCampaignId = adminCtx?.selectedCampaignId ?? null;
  const effectiveFilterCampaign = adminCtx ? (adminCampaignId ?? '') : filterCampaign;
  const setEffectiveFilterCampaign = adminCtx
    ? (id: string) => adminCtx.setSelectedCampaign(id)
    : (id: string) => setFilterCampaign(id);
  const [filterCity, setFilterCity] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    if (!supabase) {
      const cityById = new Map(fallbackCities.map((c) => [c.id, c.name]));
      setRows(
        fallbackBusinesses.slice(0, 3).map((b, i) => ({
          id: `fb-${i}`,
          campaign_id: fallbackCampaign.id,
          campaign: `${fallbackCampaign.year}`,
          city_id: b.city_id ?? '',
          city: cityById.get(b.city_id ?? '') ?? '—',
          category_id: fallbackCategories[0]?.id ?? '',
          category: fallbackCategories[0]?.name ?? '—',
          business_id: b.id,
          business: b.name,
          featured: i === 0,
          active: true,
          position: i + 1,
        })),
      );
      setCampaigns([fallbackCampaign]);
      setCities(fallbackCities);
      setCategories(fallbackCategories);
      setBusinesses(fallbackBusinesses);
      setLoading(false);
      return;
    }
    const [entriesRes, campRes, cityRes, catRes, bizRes] = await Promise.all([
      supabase.from('campaign_entries').select('id, campaign_id, city_id, category_id, business_id, active, featured, position, campaign:campaigns(year), city:cities(name), category:categories(name), business:businesses(name)').order('position').limit(1000),
      // FASE 5C.3.6 — SOMENTE edições do programa selecionado.
      adminProgramId
        ? supabase.from('campaigns').select('*').eq('award_program_id', adminProgramId).order('year', { ascending: false })
        : supabase.from('campaigns').select('*').order('year', { ascending: false }),
      supabase.from('cities').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('businesses').select('*').eq('active', true).order('name').limit(1000),
    ]);
    const mapped: EntryRow[] = ((entriesRes.data ?? []) as unknown as {
      id: string; campaign_id: string; city_id: string; category_id: string; business_id: string;
      active: boolean; featured: boolean; position: number;
      campaign: { year: number } | null; city: { name: string } | null;
      category: { name: string } | null; business: { name: string } | null;
    }[]).map((e) => ({
      id: e.id,
      campaign_id: e.campaign_id,
      campaign: String(e.campaign?.year ?? '—'),
      city_id: e.city_id,
      city: e.city?.name ?? '—',
      category_id: e.category_id,
      category: e.category?.name ?? '—',
      business_id: e.business_id,
      business: e.business?.name ?? '—',
      featured: e.featured,
      active: e.active,
      position: e.position,
    }));
    setRows(mapped);
    const scopedCampaigns = (((campRes.data ?? []) as Campaign[]).filter((c) =>
      adminProgramId ? c.award_program_id === adminProgramId : true,
    ));
    setCampaigns(scopedCampaigns);
    setCities((cityRes.data ?? []) as City[]);
    setCategories((catRes.data ?? []) as Category[]);
    setBusinesses((bizRes.data ?? []) as Business[]);
    // Com contexto, o filtro vive no contexto (não em estado local).
    if (!adminCtx && !filterCampaign && (campRes.data ?? []).length > 0) {
      const list = (campRes.data ?? []) as Campaign[];
      const active = list.find((c) => c.status === 'votacao' || c.status === 'activa') ?? list[0];
      setFilterCampaign(active.id);
    }
    setLoading(false);
  }, [filterCampaign, adminCtx, adminProgramId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => rows.filter(
      (r) =>
        (!effectiveFilterCampaign || r.campaign_id === effectiveFilterCampaign) &&
        (!filterCity || r.city_id === filterCity) &&
        (!filterCategory || r.category_id === filterCategory),
    ),
    [rows, effectiveFilterCampaign, filterCity, filterCategory],
  );

  function openCreate() {
    setForm({
      campaign_id: effectiveFilterCampaign || campaigns[0]?.id || '',
      city_id: filterCity,
      category_id: filterCategory,
      business_id: '',
      featured: false,
      position: filtered.length + 1,
      active: true,
    });
    setFormError(null);
    setModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    if (!form.campaign_id || !form.city_id || !form.category_id || !form.business_id) {
      setFormError('Edição, cidade, categoria e negócio são obrigatórios.');
      return;
    }
    // Prevenção client-side de duplicados (a BD impõe UNIQUE como barreira final).
    const dup = rows.some(
      (r) => r.campaign_id === form.campaign_id && r.city_id === form.city_id && r.category_id === form.category_id && r.business_id === form.business_id,
    );
    if (dup) {
      setFormError('Este negócio já participa nesta edição × cidade × categoria.');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from('campaign_entries').insert({
        campaign_id: form.campaign_id,
        city_id: form.city_id,
        category_id: form.category_id,
        business_id: form.business_id,
        featured: form.featured,
        position: form.position,
        active: form.active,
      }).select('id').single();
      if (error) throw error;
      await audit('entry.create', 'campaign_entries', (data as { id: string }).id, {
        campaign_id: form.campaign_id,
        city_id: form.city_id,
        category_id: form.category_id,
        business_id: form.business_id,
      });
      setModal(false);
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao registar o participante.';
      setFormError(
        message.includes('duplicate') || message.includes('unique')
          ? 'Este negócio já participa nesta edição × cidade × categoria.'
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: EntryRow) {
    if (!supabase || row.id.startsWith('fb-')) return;
    const { error } = await supabase.from('campaign_entries').update({ active: !row.active }).eq('id', row.id);
    if (!error) {
      await audit(row.active ? 'entry.deactivate' : 'entry.activate', 'campaign_entries', row.id, { business: row.business });
      load();
    }
  }

  async function toggleFeatured(row: EntryRow) {
    if (!supabase || row.id.startsWith('fb-')) return;
    const { error } = await supabase.from('campaign_entries').update({ featured: !row.featured }).eq('id', row.id);
    if (!error) {
      await audit('entry.feature', 'campaign_entries', row.id, { business: row.business, featured: !row.featured });
      load();
    }
  }

  async function move(row: EntryRow, dir: -1 | 1) {
    if (!supabase || row.id.startsWith('fb-')) return;
    const siblings = filtered
      .filter((r) => r.campaign_id === row.campaign_id && r.city_id === row.city_id && r.category_id === row.category_id)
      .sort((a, b) => a.position - b.position);
    const idx = siblings.findIndex((s) => s.id === row.id);
    const other = siblings[idx + dir];
    if (!other) return;
    const { error: e1 } = await supabase.from('campaign_entries').update({ position: other.position }).eq('id', row.id);
    if (e1) return;
    const { error: e2 } = await supabase.from('campaign_entries').update({ position: row.position }).eq('id', other.id);
    if (!e2) {
      await audit('entry.reorder', 'campaign_entries', row.id, { business: row.business, from: row.position, to: other.position });
      load();
    }
  }

  async function remove(row: EntryRow) {
    if (!supabase || row.id.startsWith('fb-')) return;
    if (!window.confirm(`Remover «${row.business}» desta participação? Os votos históricos são sempre preservados.`)) return;
    const { error } = await supabase.from('campaign_entries').delete().eq('id', row.id);
    if (!error) {
      await audit('business.remove_from_campaign', 'campaign_entries', row.id, {
        business: row.business, city: row.city, category: row.category, campaign: row.campaign,
      });
      load();
      return;
    }
    // Guarda Phase 3 (migração 0006): participações com votos não podem ser
    // eliminadas fisicamente — desactiva-se em vez disso, preservando o histórico.
    if (String(error.message).includes('PHASE3_GUARD')) {
      const { error: e2 } = await supabase.from('campaign_entries').update({ active: false }).eq('id', row.id);
      if (!e2) {
        await audit('business.remove_from_campaign', 'campaign_entries', row.id, {
          business: row.business, city: row.city, category: row.category, campaign: row.campaign,
          mode: 'deactivated_votes_preserved',
        });
        load();
      }
      return;
    }
  }

  if (loading) return <PageLoading label="A carregar participantes…" />;

  return (
    <div>
      <AdminHeader
        title="Participantes"
        description="Atribuição de negócios a edições × cidades × categorias. A BD impede duplicados (constraint única); a remoção preserva votos históricos."
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured}
            title={isSupabaseConfigured ? 'Novo participante' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Novo participante
          </button>
        }
      />
      <SupabaseNotice />

      <AdminCard title="Filtros — edição × cidade × categoria" className="mb-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Edição">
            <Select value={effectiveFilterCampaign} onChange={(e) => setEffectiveFilterCampaign(e.target.value)}>
              <option value="" className="bg-navy-900">Todas</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} className="bg-navy-900">{c.year} · {c.status}</option>
              ))}
            </Select>
          </Field>
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
        </div>
        <p className="mt-3 text-xs text-slate-500">{filtered.length} de {rows.length} participações · ordenação manual por «Posição» dentro de cada grupo.</p>
      </AdminCard>

      <AdminCard title={`Participantes (${filtered.length})`}>
        <AdminTable<EntryRow>
          searchable
          searchKeys={['business', 'city', 'category', 'campaign']}
          searchPlaceholder="Pesquisar participantes…"
          rows={filtered}
          emptyMessage="Sem participantes para estes filtros. Seleccione edição, cidade e categoria e adicione negócios."
          columns={[
            { key: 'business', label: 'Negócio', render: (r) => <span className="font-medium text-white">{r.business}</span> },
            { key: 'city', label: 'Cidade' },
            { key: 'category', label: 'Categoria' },
            { key: 'campaign', label: 'Edição' },
            {
              key: 'position', label: 'Ordem',
              render: (r) => (
                <span className="inline-flex items-center gap-1">
                  <span className="w-6 text-center font-semibold text-gold-300">{r.position}</span>
                  <button onClick={() => move(r, -1)} title="Subir" className="rounded border border-white/15 p-1 text-slate-400 hover:text-gold-300"><ArrowUp className="h-3 w-3" /></button>
                  <button onClick={() => move(r, 1)} title="Descer" className="rounded border border-white/15 p-1 text-slate-400 hover:text-gold-300"><ArrowDown className="h-3 w-3" /></button>
                </span>
              ),
            },
            { key: 'featured', label: 'Destaque', render: (r) => (
              <button onClick={() => toggleFeatured(r)} title={r.featured ? 'Remover destaque' : 'Destacar'} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${r.featured ? 'border-gold-500/50 bg-gold-500/15 text-gold-200' : 'border-white/15 text-slate-500 hover:text-white'}`}>
                <Star className="h-3 w-3" /> {r.featured ? 'Destaque' : '—'}
              </button>
            ) },
            { key: 'active', label: 'Estado', render: (r) => <StatusPill active={r.active} /> },
            {
              key: 'actions', label: 'Acções',
              render: (r) => (
                <span className="flex gap-1.5">
                  <button
                    onClick={() => toggleActive(r)}
                    disabled={!isSupabaseConfigured || r.id.startsWith('fb-')}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                  >
                    {r.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => remove(r)}
                    disabled={!isSupabaseConfigured || r.id.startsWith('fb-')}
                    title="Remover da campanha (votos preservados)"
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" /> Remover
                  </button>
                </span>
              ),
            },
          ]}
        />
      </AdminCard>

      {modal && (
        <Modal title="Novo participante" onClose={() => setModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <Field label="Negócio">
                <Select value={form.business_id} onChange={(e) => setForm({ ...form, business_id: e.target.value })} required>
                  <option value="" className="bg-navy-900">— Escolher —</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id} className="bg-navy-900">{b.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Posição (ordenação manual)">
                <TextInput type="number" min={0} value={form.position} onChange={(e) => setForm({ ...form, position: Number(e.target.value) })} />
              </Field>
              <div className="flex items-end pb-0.5">
                <Toggle checked={form.featured} onChange={(v) => setForm({ ...form, featured: v })} label="Destaque na listagem" />
              </div>
            </div>
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Participação activa" />
            <FormActions onCancel={() => setModal(false)} saving={saving} saveLabel="Registar participante" />
          </form>
        </Modal>
      )}
    </div>
  );
}
