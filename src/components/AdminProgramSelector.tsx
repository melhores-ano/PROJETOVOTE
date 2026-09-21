/**
 * THE BEST EUROPA — FASE 5C.3.6 — Seletor Programa + Edição (Admin).
 *
 * Integra-se na sidebar do Admin sem reformular a interface:
 *   PROGRAMA [ Melhores do Ano Portugal ▼ ]
 *   EDIÇÃO   [ 2026 — Votação ▼ ] [Edição ativa] [+ Criar nova edição]
 *
 * - "Criar nova edição": interface explícita (utilizador inicia). Nunca cria
 *   2027 automaticamente. award_program_id = programa selecionado.
 * - "Tornar edição ativa": ação explícita com confirmação; atualiza SOMENTE
 *   site_settings.active_campaign_slug do programa. Criar ≠ ativar.
 * - Fundação "criar com base na edição anterior": checkbox/registo de
 *   intenção em auditoria; NESTA FASE não clona categorias/participações e
 *   NUNCA votos/resultados.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, Megaphone, Plus, Rocket } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabase';
import { slugify } from '../lib/utils';
import type { CampaignStatus } from '../types/database';
import { Field, TextInput, Select, Modal, FormError, FormActions } from './AdminForm';
import {
  createEdition,
  setActiveEdition,
  useAdminProgram,
} from '../hooks/useAdminProgram';

const STATUSES: CampaignStatus[] = ['rascunho', 'activa', 'votacao', 'encerrada', 'arquivada'];

interface CreateForm {
  year: number;
  name: string;
  slug: string;
  start_at: string;
  end_at: string;
  status: CampaignStatus;
  basedOn: string;
}

export function AdminProgramSelector() {
  const ctx = useAdminProgram();
  const {
    programs,
    selectedProgram,
    selectedProgramId,
    campaigns,
    selectedCampaign,
    selectedCampaignId,
    activeCampaignSlug,
    loading,
    error,
    setSelectedProgram,
    setSelectedCampaign,
    refresh,
    campaignStatusLabel,
    isActiveCampaign,
  } = ctx;

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>({
    year: 2027,
    name: '',
    slug: '',
    start_at: '',
    end_at: '',
    status: 'rascunho',
    basedOn: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editionOptions = useMemo(() => campaigns, [campaigns]);

  function openCreate() {
    if (!selectedProgram) return;
    const nextYear = Math.max(2026, ...campaigns.map((c) => c.year)) + 1;
    const baseName = selectedProgram.name || 'Programa';
    setForm({
      year: nextYear,
      name: `${baseName} ${nextYear}`.replace('Prémios ', 'Prémios ').trim(),
      slug: slugify(`premios-${baseName}-${nextYear}`),
      start_at: '',
      end_at: '',
      status: 'rascunho',
      basedOn: selectedCampaignId ?? '',
    });
    setFormError(null);
    setCreateOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!selectedProgramId) {
      setFormError('Sem programa válido — fail-closed: escolha um programa.');
      return;
    }
    setSaving(true);
    try {
      const { id } = await createEdition(selectedProgramId, {
        year: form.year,
        name: form.name,
        slug: form.slug,
        start_at: form.start_at || null,
        end_at: form.end_at || null,
        status: form.status,
        basedOnCampaignId: form.basedOn || null,
      });
      setCreateOpen(false);
      refresh();
      // Seleciona a edição recém-criada após a recarga.
      window.setTimeout(() => setSelectedCampaign(id), 600);
      setNotice(`Edição ${form.year} criada em rascunho. Não está ativa — use «Tornar edição ativa» quando for o momento.`);
      window.setTimeout(() => setNotice(null), 8000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao criar a edição.');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    setActionError(null);
    if (!selectedProgramId || !selectedCampaign) return;
    const label = `${selectedCampaign.year} — ${selectedCampaign.name}`;
    if (!window.confirm(`Tornar «${label}» a edição ativa de «${selectedProgram?.name}»?\n\nIsto atualiza SOMENTE site_settings.active_campaign_slug do programa. A edição anterior NÃO é apagada.`)) {
      return;
    }
    // Verificação programa × campanha antes de executar.
    if (selectedCampaign.award_program_id !== selectedProgramId) {
      setActionError('A edição não pertence ao programa selecionado — activação recusada.');
      return;
    }
    setActivating(true);
    try {
      await setActiveEdition(selectedProgramId, selectedCampaign);
      refresh();
      setNotice(`Edição ${selectedCampaign.year} agora é a edição ativa.`);
      window.setTimeout(() => setNotice(null), 8000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao ativar a edição.');
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3" aria-busy="true">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Programa · Edição</p>
        <p className="mt-1 text-xs text-slate-500">A carregar contexto…</p>
      </div>
    );
  }

  // FAIL-CLOSED: sem programa válido, não mostrar dados de Portugal por fallback.
  if (!selectedProgram) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-3" role="alert">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-300">Programa · Edição</p>
        <p className="mt-1 text-xs text-red-200">
          {error ?? 'Sem programa válido. Verifique award_programs (nenhum programa ativo).'}
        </p>
      </div>
    );
  }

  const selectedIsActive = selectedCampaign ? isActiveCampaign(selectedCampaign) : false;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
        The Best Europa · Administração
      </p>

      <label htmlFor="admin-program" className="mt-2.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-gold-400">
        Programa
      </label>
      <select
        id="admin-program"
        value={selectedProgramId ?? ''}
        onChange={(e) => setSelectedProgram(e.target.value)}
        className="mt-1 w-full rounded-lg border border-white/15 bg-navy-950 px-2.5 py-2 text-[13px] font-medium text-white outline-none transition focus:border-gold-500/60"
      >
        {programs.map((p) => (
          <option key={p.id} value={p.id} className="bg-navy-900">
            {p.name}
          </option>
        ))}
      </select>

      <label htmlFor="admin-edition" className="mt-2.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-gold-400">
        Edição
      </label>
      {editionOptions.length === 0 ? (
        <p className="mt-1 rounded-lg border border-dashed border-white/15 px-2.5 py-2 text-xs text-slate-500" role="status">
          Sem edições neste programa. Crie a primeira edição abaixo.
        </p>
      ) : (
        <select
          id="admin-edition"
          value={selectedCampaignId ?? ''}
          onChange={(e) => setSelectedCampaign(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-navy-950 px-2.5 py-2 text-[13px] font-medium text-white outline-none transition focus:border-gold-500/60"
        >
          {editionOptions.map((c) => (
            <option key={c.id} value={c.id} className="bg-navy-900">
              {c.year} — {campaignStatusLabel(c.status)}
              {activeCampaignSlug && c.slug === activeCampaignSlug ? ' · activa' : ''}
            </option>
          ))}
        </select>
      )}

      {selectedCampaign && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {selectedIsActive ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> Edição ativa
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-medium text-slate-400">
              <Megaphone className="h-3 w-3" /> Não é a edição ativa
            </span>
          )}
          <span className="text-slate-500">
            {selectedCampaign.year} · {campaignStatusLabel(selectedCampaign.status)}
          </span>
        </p>
      )}

      {notice && (
        <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200" role="alert">
          {actionError}
        </p>
      )}

      <div className="mt-2.5 flex flex-col gap-1.5">
        <button
          onClick={openCreate}
          disabled={!isSupabaseConfigured}
          title={isSupabaseConfigured ? 'Criar nova edição neste programa' : 'Disponível após configurar o Supabase'}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gold-gradient px-3 py-2 text-xs font-bold text-navy-950 transition hover:brightness-110 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Criar nova edição
        </button>
        {selectedCampaign && !selectedIsActive && (
          <button
            onClick={handleActivate}
            disabled={!isSupabaseConfigured || activating}
            title="Tornar a edição selecionada a edição pública ativa"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
          >
            <Rocket className="h-3.5 w-3.5" /> {activating ? 'A ativar…' : 'Tornar edição ativa'}
          </button>
        )}
      </div>

      {createOpen && (
        <Modal title={`Nova edição — ${selectedProgram.name}`} onClose={() => setCreateOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <FormError message={formError} />
            <div className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-3 text-xs leading-relaxed text-slate-400">
              <p>
                Programa: <strong className="text-white">{selectedProgram.name}</strong>
              </p>
              <p className="mt-1">
                Criar ≠ ativar. A nova edição nasce em <strong className="text-slate-200">rascunho</strong> e
                nunca copia votos, tentativas, ajustes, resultados ou auditoria da edição anterior.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="Nome">
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label="Ano">
                <TextInput type="number" min={2020} max={2100} value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} required />
              </Field>
            </div>
            <Field label="Slug">
              <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Início">
                <TextInput type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
              </Field>
              <Field label="Fim">
                <TextInput type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
              </Field>
            </div>
            <Field label="Estado inicial">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-navy-900">{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Criar com base na edição anterior (fundação — sem clonagem automática)">
              <Select value={form.basedOn} onChange={(e) => setForm({ ...form, basedOn: e.target.value })}>
                <option value="" className="bg-navy-900">— Edição em branco (recomendado) —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id} className="bg-navy-900">
                    {c.year} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="-mt-2 text-[11px] leading-relaxed text-slate-500">
              A opção acima regista apenas a intenção em auditoria. A clonagem seletiva futura
              (categorias / participações elegíveis) ainda não está implementada — votos e
              resultados nunca serão copiados.
            </p>
            <FormActions onCancel={() => setCreateOpen(false)} saving={saving} saveLabel="Criar edição" />
          </form>
        </Modal>
      )}
    </div>
  );
}
