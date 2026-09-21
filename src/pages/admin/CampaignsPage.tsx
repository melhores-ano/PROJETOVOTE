import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Play, CalendarClock, Lock, Eye, EyeOff, Archive } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { slugify, formatDatePt } from '../../lib/utils';
import { createEdition, setActiveEdition, useOptionalAdminProgram } from '../../hooks/useAdminProgram';
import type { Campaign, CampaignStatus } from '../../types/database';
import { fallbackCampaign } from '../../data/fallback';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { Field, TextInput, Select, Toggle, Modal, FormError, FormActions } from '../../components/AdminForm';
import { PageLoading } from '../../components/ui';

const STATUSES: CampaignStatus[] = ['rascunho', 'activa', 'votacao', 'encerrada', 'arquivada'];

interface CampaignFormState {
  name: string;
  slug: string;
  year: number;
  start_at: string;
  end_at: string;
  status: CampaignStatus;
  results_public: boolean;
}

const emptyForm: CampaignFormState = {
  name: '', slug: '', year: 2027, start_at: '', end_at: '', status: 'rascunho', results_public: false,
};

function toInput(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CampaignsPage() {
  // FASE 5C.3.6 — programa selecionado no contexto Admin (única fonte).
  const adminCtx = useOptionalAdminProgram();
  const programId = adminCtx?.selectedProgramId ?? null;
  const programName = adminCtx?.selectedProgram?.name ?? null;
  const activeSlug = adminCtx?.activeCampaignSlug ?? null;
  const [rows, setRows] = useState<Campaign[]>([fallbackCampaign]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; campaign: Campaign } | null>(null);
  const [form, setForm] = useState<CampaignFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (!supabase) {
      setRows([{ ...fallbackCampaign, award_program_id: programId }]);
      setLoading(false);
      return;
    }
    // FASE 5C.3.6 — SOMENTE campaigns do programa selecionado (ano desc).
    // Sem programa válido: fail-closed (sem dados de outro programa).
    if (adminCtx && !programId) {
      setRows([]);
      setLoading(false);
      return;
    }
    let q = supabase.from('campaigns').select('*').order('year', { ascending: false });
    if (programId) q = q.eq('award_program_id', programId);
    const { data } = await q;
    const list = ((data ?? []) as Campaign[]).filter((c) =>
      programId ? c.award_program_id === programId : true,
    );
    setRows(list.length > 0 ? list : programId ? [] : [fallbackCampaign]);
    setLoading(false);
  }, [programId, adminCtx]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    const baseYear = rows.length > 0 ? Math.max(...rows.map((r) => r.year)) : 2026;
    const nextYear = baseYear + 1;
    const base = programName ?? 'Prémios Melhores do Ano Portugal';
    setForm({ ...emptyForm, year: nextYear, name: `${base} ${nextYear}`, slug: slugify(`premios-${base}-${nextYear}`) });
    setFormError(null);
    setModal({ mode: 'create' });
  }

  function openEdit(campaign: Campaign) {
    setForm({
      name: campaign.name,
      slug: campaign.slug,
      year: campaign.year,
      start_at: toInput(campaign.start_at),
      end_at: toInput(campaign.end_at),
      status: campaign.status,
      results_public: campaign.results_public,
    });
    setFormError(null);
    setModal({ mode: 'edit', campaign });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim() || !form.year) {
      setFormError('Nome, slug e ano são obrigatórios.');
      return;
    }
    if (form.start_at && form.end_at && new Date(form.start_at) >= new Date(form.end_at)) {
      setFormError('A data de fim deve ser posterior à data de início.');
      return;
    }
    setSaving(true);
    try {
      if (modal && 'campaign' in modal) {
        const payload = {
          name: form.name.trim(),
          slug: slugify(form.slug.trim()),
          year: form.year,
          start_at: form.start_at ? new Date(form.start_at).toISOString() : null,
          end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
          status: form.status,
          results_public: form.results_public,
        };
        const { error } = await supabase.from('campaigns').update(payload).eq('id', modal.campaign.id);
        if (error) throw error;
        await audit('campaign.update', 'campaigns', modal.campaign.id, { name: payload.name, status: payload.status });
      } else {
        // FASE 5C.3.6 — criação program-scoped via helper central (UNIQUE
        // (award_program_id, year) é a autoridade; nunca copia votos).
        if (adminCtx && programId) {
          const { id } = await createEdition(programId, {
            year: form.year,
            name: form.name,
            slug: form.slug,
            start_at: form.start_at || null,
            end_at: form.end_at || null,
            status: form.status,
          });
          // results_public nasce false no helper; aplica-se se o admin pediu true.
          if (form.results_public) {
            await supabase.from('campaigns').update({ results_public: true }).eq('id', id);
          }
        } else if (adminCtx && !programId) {
          throw new Error('Sem programa válido — fail-closed: escolha um programa antes de criar.');
        } else {
          const payload = {
            name: form.name.trim(),
            slug: slugify(form.slug.trim()),
            year: form.year,
            start_at: form.start_at ? new Date(form.start_at).toISOString() : null,
            end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
            status: form.status,
            results_public: form.results_public,
          };
          const { data, error } = await supabase.from('campaigns').insert(payload).select('id').single();
          if (error) throw error;
          await audit('campaign.create', 'campaigns', (data as { id: string }).id, { name: payload.name, year: payload.year });
        }
      }
      setModal(null);
      load();
      adminCtx?.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao guardar a campanha.');
    } finally {
      setSaving(false);
    }
  }

  /** Transições operacionais auditadas. Nunca eliminam dados históricos de votos. */
  async function transition(c: Campaign, action: 'activate' | 'schedule' | 'close' | 'publish' | 'unpublish' | 'archive' | 'set_active') {
    setActionError(null);
    if (!supabase) {
      setActionError('Supabase por configurar — acções desactivadas em modo de demonstração.');
      return;
    }
    setActingId(c.id);
    try {
      if (action === 'activate') {
        const { error } = await supabase.from('campaigns').update({ status: 'votacao' }).eq('id', c.id);
        if (error) throw error;
        await audit('campaign.activate', 'campaigns', c.id, { name: c.name, year: c.year, from: c.status, to: 'votacao' });
      } else if (action === 'schedule') {
        const start = window.prompt('Agendar início (AAAA-MM-DDTHH:mm):', toInput(c.start_at) || '');
        if (start === null) return;
        const end = window.prompt('Agendar fim (AAAA-MM-DDTHH:mm):', toInput(c.end_at) || '');
        if (end === null) return;
        const payload = {
          start_at: start ? new Date(start).toISOString() : null,
          end_at: end ? new Date(end).toISOString() : null,
          status: 'activa' as CampaignStatus,
        };
        const { error } = await supabase.from('campaigns').update(payload).eq('id', c.id);
        if (error) throw error;
        await audit('campaign.schedule', 'campaigns', c.id, { name: c.name, ...payload });
      } else if (action === 'close') {
        if (!window.confirm(`Encerrar a edição ${c.year}? A votação fecha, mas todos os votos históricos são preservados.`)) return;
        const { error } = await supabase.from('campaigns').update({ status: 'encerrada' }).eq('id', c.id);
        if (error) throw error;
        await audit('campaign.close', 'campaigns', c.id, { name: c.name, year: c.year });
      } else if (action === 'publish') {
        if (!window.confirm(`Publicar resultados da edição ${c.year}? As páginas públicas de vencedores ficarão visíveis.`)) return;
        const { error } = await supabase.from('campaigns').update({ results_public: true }).eq('id', c.id);
        if (error) throw error;
        await audit('results.publish', 'campaigns', c.id, { name: c.name, year: c.year });
      } else if (action === 'unpublish') {
        if (!window.confirm(`Ocultar resultados da edição ${c.year}? As páginas públicas voltarão a mostrar "Resultados ainda não publicados" e nenhum total/ranking ficará acessível.`)) return;
        const { error } = await supabase.from('campaigns').update({ results_public: false }).eq('id', c.id);
        if (error) throw error;
        await audit('results.unpublish', 'campaigns', c.id, { name: c.name, year: c.year });
      } else if (action === 'archive') {
        if (!window.confirm(`Arquivar a edição ${c.year}? O histórico de votos é preservado; a edição sai da operação activa.`)) return;
        const { error } = await supabase.from('campaigns').update({ status: 'arquivada' }).eq('id', c.id);
        if (error) throw error;
        await audit('campaign.archive', 'campaigns', c.id, { name: c.name, year: c.year });
      } else if (action === 'set_active') {
        // FASE 5C.3.6 — ativação explícita: SOMENTE site_settings.
        if (!programId) {
          setActionError('Sem programa válido — fail-closed.');
          return;
        }
        if (c.award_program_id !== programId) {
          setActionError('A edição não pertence ao programa selecionado — activação recusada.');
          return;
        }
        if (!window.confirm(`Tornar «${c.year} — ${c.name}» a edição ativa? Isto atualiza SOMENTE site_settings.active_campaign_slug. A edição anterior NÃO é apagada.`)) return;
        await setActiveEdition(programId, c);
        adminCtx?.refresh();
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha na operação.');
    } finally {
      setActingId(null);
    }
  }

  if (loading) return <PageLoading label="A carregar campanhas…" />;

  return (
    <div>
      <AdminHeader
        title="Campanhas"
        description={`Edições do programa ${programName ?? 'selecionado'}. Criar uma nova edição nunca elimina votos históricos — os dados de edições anteriores são preservados. Criar ≠ ativar.`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured}
            title={isSupabaseConfigured ? 'Nova edição' : 'Disponível após configurar o Supabase'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova edição
          </button>
        }
      />
      <SupabaseNotice />
      {actionError && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">{actionError}</p>
      )}
      <AdminCard title={`Edições registadas (${rows.length})`}>
        <AdminTable<Campaign>
          searchable
          searchKeys={['name', 'slug', 'year', 'status']}
          searchPlaceholder="Pesquisar edições…"
          rows={rows}
          columns={[
            { key: 'year', label: 'Ano', render: (r) => (
              <span className="inline-flex items-center gap-1.5">
                <strong className="text-gold-300">{String(r.year)}</strong>
                {activeSlug && r.slug === activeSlug && (
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                    Edição ativa
                  </span>
                )}
              </span>
            ) },
            { key: 'name', label: 'Nome', render: (r) => <span className="font-medium">{String(r.name)}</span> },
            { key: 'status', label: 'Estado', render: (r) => <StatusPill active={['activa', 'votacao'].includes(String(r.status))} activeLabel={String(r.status)} inactiveLabel={String(r.status)} /> },
            { key: 'start_at', label: 'Início', render: (r) => formatDatePt(r.start_at as string | null) },
            { key: 'end_at', label: 'Fim', render: (r) => formatDatePt(r.end_at as string | null) },
            { key: 'results_public', label: 'Resultados', render: (r) => (r.results_public ? 'Públicos' : 'Privados') },
            {
              key: 'actions', label: 'Acções',
              render: (r) => (
                <span className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => openEdit(r)}
                    disabled={!isSupabaseConfigured}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                  >
                    <Pencil className="h-3 w-3" /> Editar
                  </button>
                  {['rascunho', 'activa', 'encerrada'].includes(String(r.status)) && (
                    <button
                      onClick={() => transition(r, 'activate')}
                      disabled={!isSupabaseConfigured || actingId === r.id}
                      title="Activar votação"
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                    >
                      <Play className="h-3 w-3" /> Activar
                    </button>
                  )}
                  <button
                    onClick={() => transition(r, 'schedule')}
                    disabled={!isSupabaseConfigured || actingId === r.id}
                    title="Agendar início/fim"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                  >
                    <CalendarClock className="h-3 w-3" /> Agendar
                  </button>
                  {['activa', 'votacao'].includes(String(r.status)) && (
                    <button
                      onClick={() => transition(r, 'close')}
                      disabled={!isSupabaseConfigured || actingId === r.id}
                      title="Encerrar votação (preserva votos)"
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      <Lock className="h-3 w-3" /> Encerrar
                    </button>
                  )}
                  <button
                    onClick={() => transition(r, r.results_public ? 'unpublish' : 'publish')}
                    disabled={!isSupabaseConfigured || actingId === r.id}
                    title={r.results_public ? 'Ocultar resultados públicos' : 'Publicar resultados'}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                  >
                    {r.results_public ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {r.results_public ? 'Ocultar' : 'Publicar'}
                  </button>
                  {String(r.status) !== 'arquivada' && (
                    <button
                      onClick={() => transition(r, 'archive')}
                      disabled={!isSupabaseConfigured || actingId === r.id}
                      title="Arquivar edição (preserva histórico)"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-400 hover:border-white/40 hover:text-white disabled:opacity-40"
                    >
                      <Archive className="h-3 w-3" /> Arquivar
                    </button>
                  )}
                  {!(activeSlug && r.slug === activeSlug) && (
                    <button
                      onClick={() => transition(r, 'set_active')}
                      disabled={!isSupabaseConfigured || actingId === r.id || !programId}
                      title="Tornar edição ativa (só site_settings)"
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                    >
                      <Play className="h-3 w-3" /> Tornar ativa
                    </button>
                  )}
                </span>
              ),
            },
          ]}
        />
        <p className="mt-3 text-[11px] text-slate-500">As edições nunca são eliminadas: o encerramento e o arquivo preservam todos os votos e o apuramento histórico.</p>
      </AdminCard>

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Nova edição' : `Editar — ${(modal as { campaign: Campaign }).campaign.name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormError message={formError} />
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="Nome">
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Prémios Melhores do Ano Portugal 2027" required />
              </Field>
              <Field label="Ano">
                <TextInput type="number" min={2020} max={2100} value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} required />
              </Field>
            </div>
            <Field label="Slug">
              <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Início agendado">
                <TextInput type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
              </Field>
              <Field label="Fim agendado">
                <TextInput type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
              </Field>
            </div>
            <Field label="Estado">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-navy-900">{s}</option>
                ))}
              </Select>
            </Field>
            <Toggle checked={form.results_public} onChange={(v) => setForm({ ...form, results_public: v })} label="Resultados públicos nesta edição" />
            <FormActions onCancel={() => setModal(null)} saving={saving} />
          </form>
        </Modal>
      )}
    </div>
  );
}
