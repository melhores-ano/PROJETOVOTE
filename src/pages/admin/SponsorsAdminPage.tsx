/**
 * THE BEST EUROPA — FASE 5C.3.7 — Admin > Patrocinadores (isolado).
 *
 * Arquitetura: award_program_id IS NULL = global The Best Europa;
 * award_program_id = programa = específico do programa selecionado.
 * Patrocinadores de OUTRO programa nunca são listados nem editáveis.
 * Criação/edição permite SOMENTE: Global OU programa atual.
 */
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { slugify } from '../../lib/utils';
import { useScopedSponsors } from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { sponsorScopeLabel } from '../../lib/adminScope';
import type { Sponsor } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, Select, Toggle, Modal, FormError, FormActions, ImageField } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface SponsorFormState {
  name: string;
  slug: string;
  logo_url: string;
  website: string;
  tier: string;
  position: number;
  active: boolean;
  /** 'global' = The Best Europa (NULL) | 'program' = programa atual. */
  scope: 'global' | 'program';
}

const emptyForm: SponsorFormState = { name: '', slug: '', logo_url: '', website: '', tier: 'prata', position: 0, active: true, scope: 'program' };

export default function SponsorsAdminPage() {
  const { selectedProgram, selectedProgramId } = useAdminProgram();
  const query = useScopedSponsors(selectedProgramId);
  const rows = query.data ?? [];
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; sponsor: Sponsor } | null>(null);
  const [form, setForm] = useState<SponsorFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId);

  function openCreate() {
    setForm({ ...emptyForm, position: rows.length + 1, scope: 'program' });
    setFormError(null);
    setModal({ mode: 'create' });
  }

  function openEdit(sponsor: Sponsor) {
    // Defesa: patrocinador de outro programa nunca é editável aqui.
    const owner = sponsor.award_program_id ?? null;
    if (owner !== null && owner !== selectedProgramId) return;
    setForm({
      name: sponsor.name,
      slug: sponsor.slug,
      logo_url: sponsor.logo_url ?? '',
      website: sponsor.website ?? '',
      tier: sponsor.tier ?? 'prata',
      position: sponsor.position,
      active: sponsor.active,
      scope: owner === null ? 'global' : 'program',
    });
    setFormError(null);
    setModal({ mode: 'edit', sponsor });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    if (!hasProgram || !selectedProgramId) {
      setFormError('Sem programa válido — fail-closed: selecione um programa no seletor global.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Nome e slug são obrigatórios.');
      return;
    }
    // Defesa: edição de outro programa recusada.
    if (modal && 'sponsor' in modal) {
      const owner = (modal.sponsor.award_program_id ?? null) as string | null;
      if (owner !== null && owner !== selectedProgramId) {
        setFormError('Este patrocinador pertence a outro programa — edição recusada.');
        return;
      }
    }
    setSaving(true);
    try {
      // SOMENTE Global (NULL) ou programa atual — nunca outro programa.
      const award_program_id = form.scope === 'global' ? null : selectedProgramId;
      const payload = {
        name: form.name.trim(),
        slug: slugify(form.slug.trim()),
        logo_url: form.logo_url.trim() || null,
        website: form.website.trim() || null,
        tier: form.tier,
        position: form.position,
        active: form.active,
        award_program_id,
      };
      if (modal && 'sponsor' in modal) {
        const { error } = await supabase.from('sponsors').update(payload).eq('id', modal.sponsor.id);
        if (error) throw error;
        await audit('sponsor.update', 'sponsors', modal.sponsor.id, { name: payload.name });
      } else {
        const { data, error } = await supabase.from('sponsors').insert(payload).select('id').single();
        if (error) throw error;
        await audit('sponsor.create', 'sponsors', (data as { id: string }).id, { name: payload.name });
      }
      setModal(null);
      query.refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao guardar o patrocinador.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(sponsor: Sponsor) {
    if (!supabase) return;
    const { error } = await supabase.from('sponsors').update({ active: !sponsor.active }).eq('id', sponsor.id);
    if (!error) {
      await audit(sponsor.active ? 'sponsor.deactivate' : 'sponsor.activate', 'sponsors', sponsor.id, { name: sponsor.name });
      query.refetch();
    }
  }

  if (query.loading) return <PageLoading label="A carregar patrocinadores…" />;

  return (
    <div>
      <AdminHeader
        title="Patrocinadores"
        description={`Globais The Best Europa + específicos de ${selectedProgram ? selectedProgram.name : '(sem programa válido)'}. Apenas patrocinadores activos surgem no sítio público.`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured || !hasProgram}
            title={!hasProgram ? 'Selecione um programa válido primeiro' : isSupabaseConfigured ? 'Novo patrocinador' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Novo patrocinador
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhum patrocinador é apresentado por fallback." onRetry={query.refetch} />
      ) : query.error && rows.length === 0 ? (
        <ErrorState message={query.error} onRetry={query.refetch} />
      ) : (
        <AdminCard title={`Patrocinadores — visíveis em ${selectedProgram?.name} (${rows.length})`}>
          <AdminTable<Sponsor>
            searchable
            searchKeys={['name', 'tier']}
            searchPlaceholder="Pesquisar patrocinadores…"
            rows={rows}
            emptyMessage="Sem patrocinadores registados."
            columns={[
              { key: 'name', label: 'Nome', render: (r) => <span className="font-medium text-white">{r.name}</span> },
              {
                key: 'scope', label: 'Âmbito',
                render: (r) => {
                  const isGlobal = (r.award_program_id ?? null) === null;
                  return (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${isGlobal ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'border-gold-500/40 bg-gold-500/10 text-gold-200'}`}>
                      {sponsorScopeLabel(r.award_program_id, selectedProgram?.name ?? null)}
                    </span>
                  );
                },
              },
              { key: 'tier', label: 'Nível', render: (r) => <code className="text-xs text-gold-300">{String(r.tier ?? '—')}</code> },
              { key: 'position', label: 'Posição', render: (r) => String(r.position) },
              { key: 'active', label: 'Estado', render: (r) => <StatusPill active={Boolean(r.active)} /> },
              {
                key: 'actions', label: 'Acções',
                render: (r) => (
                  <span className="flex gap-2">
                    <button
                      onClick={() => openEdit(r)}
                      disabled={!isSupabaseConfigured}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => toggleActive(r)}
                      disabled={!isSupabaseConfigured}
                      className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                    >
                      {r.active ? 'Desactivar' : 'Activar'}
                    </button>
                  </span>
                ),
              },
            ]}
          />
        </AdminCard>
      )}

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Novo patrocinador' : `Editar — ${(modal as { sponsor: Sponsor }).sponsor.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormError message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value, slug: modal.mode === 'create' ? slugify(e.target.value) : form.slug })}
                  placeholder="Ex.: Banco Atlântico"
                  required
                />
              </Field>
              <Field label="Slug">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
              </Field>
            </div>
            <Field label="Âmbito do patrocinador" hint="Global = toda a marca The Best Europa. Programa = só o programa atual.">
              <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as 'global' | 'program' })}>
                <option value="program" className="bg-navy-900">Programa — {selectedProgram?.name ?? 'selecionado'}</option>
                <option value="global" className="bg-navy-900">Global — The Best Europa</option>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nível">
                <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                  {['ouro', 'prata', 'bronze', 'parceiro'].map((t) => (
                    <option key={t} value={t} className="bg-navy-900">{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Posição (ordenação)">
                <TextInput type="number" min={0} value={form.position} onChange={(e) => setForm({ ...form, position: Number(e.target.value) })} />
              </Field>
            </div>
            <ImageField
              label="Logótipo"
              value={form.logo_url}
              onChange={(url) => setForm({ ...form, logo_url: url })}
              bucket="sponsor-logos"
              slugHint={form.slug || form.name}
              hint="Upload directo para o Storage (máx. 2 MB) ou URL manual."
            />
            <Field label="Website">
              <TextInput value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" inputMode="url" />
            </Field>
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Patrocinador activo" />
            <FormActions onCancel={() => setModal(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}
