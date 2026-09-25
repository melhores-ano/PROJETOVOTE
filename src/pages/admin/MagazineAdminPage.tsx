/**
 * THE BEST EUROPA — FASE 6.4.3 — Admin > Revistas (listagem + criação).
 *
 * Rota: /admin/revistas. Isolamento estrito por programa via
 * AdminProgramProvider (única fonte). Fail-closed: sem programa válido →
 * sem dados. A revista NUNCA é resultado eleitoral: esta página NUNCA lê
 * nem escreve votos/rankings/distinções/adesões — apenas edições
 * editoriais (magazine_editions, 0021). Elegibilidade e Meta Ads não
 * participam nesta listagem.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Eraser, Plus, Settings2, UploadCloud } from 'lucide-react';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import {
  useAdminMagazineEditions,
  useMagazineCampaignOptions,
  useMagazineCityOptions,
} from '../../hooks/useAdminMagazines';
import {
  EDITION_PUBLISH_CONFIRM_TEXT,
  archiveMagazineEdition,
  createMagazineEdition,
  publishMagazineEdition,
  slugifyEditorial,
} from '../../lib/adminMagazine';
import { MAGAZINE_EDITION_STATUS_LABELS } from '../../lib/magazine';
import {
  EMPTY_MAGAZINE_DRAFT,
  clearMagazineDraft,
  isMagazineDraftEmpty,
  readMagazineDraft,
  validateMagazineDraftIds,
  writeMagazineDraft,
} from '../../lib/magazineDraft';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import type { MagazineEdition } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice, StatusPill } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Select, Modal, FormError, FormActions, ImageField } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface CreateForm {
  campaign_id: string;
  city_id: string;
  title: string;
  subtitle: string;
  slug: string;
  introduction: string;
  cover_image_url: string;
  sort_order: string;
}

const EMPTY_CREATE: CreateForm = {
  campaign_id: '',
  city_id: '',
  title: '',
  subtitle: '',
  slug: '',
  introduction: '',
  cover_image_url: '',
  sort_order: '0',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function MagazineAdminPage() {
  const { selectedProgram, selectedProgramId } = useAdminProgram();
  const programId = selectedProgramId ?? null;
  const countryCode = selectedProgram?.country_code ?? null;

  const editionsQuery = useAdminMagazineEditions(programId);
  const campaignsQuery = useMagazineCampaignOptions(programId);
  const citiesQuery = useMagazineCityOptions(countryCode);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE);
  const [draftRestored, setDraftRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<MagazineEdition | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && programId);
  const rows = useMemo(() => editionsQuery.data ?? [], [editionsQuery.data]);

  const total = rows.length;
  const drafts = rows.filter((r) => r.edition.status === 'draft').length;
  const published = rows.filter((r) => r.edition.status === 'published').length;
  const archived = rows.filter((r) => r.edition.status === 'archived').length;

  function openCreate() {
    // FASE 6.4.3.1 — restaurar rascunho local do programa atual, se existir.
    // Cancela/fecha NÃO apaga: permite continuar depois. IDs inválidos face
    // ao contexto atual são limpos individualmente (só quando as opções já
    // carregaram, para não limpar válidos durante o loading).
    const stored = readMagazineDraft(programId);
    if (stored) {
      const campaignIds = (campaignsQuery.data ?? []).map((c) => c.id);
      const cityIds = (citiesQuery.data ?? []).map((c) => c.id);
      const validated = validateMagazineDraftIds(stored, campaignIds, cityIds);
      setForm(validated);
      setDraftRestored(!isMagazineDraftEmpty(validated));
    } else {
      setForm({ ...EMPTY_MAGAZINE_DRAFT });
      setDraftRestored(false);
    }
    setFormError(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    // FASE 6.4.3.1 — fechar/X/Cancelar PRESERVA o draft (já persistido a cada
    // alteração via efeito abaixo). Não limpar aqui.
    setCreateOpen(false);
  }

  function handleClearDraft() {
    if (!window.confirm('Limpar o rascunho local desta revista? Os campos do formulário serão esvaziados.')) {
      return;
    }
    clearMagazineDraft(programId);
    setForm({ ...EMPTY_MAGAZINE_DRAFT });
    setDraftRestored(false);
    setFormError(null);
  }

  // FASE 6.4.3.1 — autosave LOCAL (localStorage) a cada alteração do
  // formulário com o modal aberto. Exclusivamente local; zero Supabase.
  // Guarda apenas URL de capa (nunca File/Blob/base64 — ImageField só expõe URL).
  useEffect(() => {
    if (!createOpen || !programId) return;
    writeMagazineDraft(programId, form);
  }, [createOpen, programId, form]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    if (!programId) {
      setFormError('Sem programa válido — fail-closed: selecione um programa no seletor global.');
      return;
    }
    if (!form.campaign_id || !form.city_id) {
      setFormError('Campanha e cidade são obrigatórias.');
      return;
    }
    if (!form.title.trim()) {
      setFormError('Título é obrigatório.');
      return;
    }
    const slug = slugifyEditorial(form.slug.trim() || form.title);
    if (!slug) {
      setFormError('Slug editorial obrigatório.');
      return;
    }
    const sortOrder = Number.parseInt(form.sort_order.trim() || '0', 10);
    setSaving(true);
    try {
      // Barreira client-side contra duplicado (campanha × cidade); a
      // autoridade é a UNIQUE (campaign_id, city_id) na BD (0021).
      const duplicate = rows.some(
        (r) => r.edition.campaign_id === form.campaign_id && r.edition.city_id === form.city_id,
      );
      if (duplicate) {
        throw new Error('Já existe uma revista para esta campanha × cidade. Uma revista por campanha × cidade.');
      }
      await createMagazineEdition({
        award_program_id: programId,
        campaign_id: form.campaign_id,
        city_id: form.city_id,
        slug,
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        introduction: form.introduction.trim() || null,
        cover_image_url: form.cover_image_url.trim() || null,
        status: 'draft',
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      });
      setCreateOpen(false);
      // FASE 6.4.3.1 — criação OK: remover o draft local e limpar o formulário.
      clearMagazineDraft(programId);
      setForm({ ...EMPTY_MAGAZINE_DRAFT });
      setDraftRestored(false);
      editionsQuery.refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao criar a revista.';
      if (/duplicate|unique|magazine_editions_campaign_city/i.test(msg)) {
        setFormError('Já existe uma revista para esta campanha × cidade (constraint campanha × cidade).');
      } else {
        setFormError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!confirmPublish) return;
    setActionError(null);
    setActingId(confirmPublish.id);
    try {
      await publishMagazineEdition(confirmPublish.id);
      setConfirmPublish(null);
      editionsQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao publicar a revista.');
    } finally {
      setActingId(null);
    }
  }

  async function handleArchive(edition: MagazineEdition) {
    setActionError(null);
    setActingId(edition.id);
    try {
      await archiveMagazineEdition(edition.id);
      editionsQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao arquivar a revista.');
    } finally {
      setActingId(null);
    }
  }

  if (editionsQuery.loading) return <PageLoading label="A carregar revistas…" />;

  return (
    <div>
      <AdminHeader
        title="Revistas"
        description={`Edições editoriais da revista digital The Best Europa${selectedProgram ? ` · ${selectedProgram.name}` : ' (sem programa válido)'}. A revista NÃO é resultado eleitoral — montar editorialmente uma edição nunca altera votos, distinções ou adesões.`}
        actions={
          <button
            onClick={openCreate}
            disabled={!isSupabaseConfigured || !hasProgram}
            title={!hasProgram ? 'Selecione um programa válido primeiro' : 'Nova revista'}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova revista
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {actionError && (
        <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
          {actionError}
        </p>
      )}

      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma revista é apresentada por fallback." onRetry={editionsQuery.refetch} />
      ) : editionsQuery.error && rows.length === 0 ? (
        <ErrorState message={editionsQuery.error} onRetry={editionsQuery.refetch} />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total de revistas', value: total },
              { label: 'Rascunhos', value: drafts },
              { label: 'Publicadas', value: published },
              { label: 'Arquivadas', value: archived },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{c.label}</p>
                <p className="mt-1 font-display text-3xl font-bold text-white">{c.value}</p>
              </div>
            ))}
          </div>

          <AdminCard title={`Revistas — ${selectedProgram?.name ?? ''} (${total})`}>
            <AdminTable
              searchable
              searchKeys={['title', 'slug', 'cityName', 'campaignName']}
              searchPlaceholder="Pesquisar revistas…"
              rows={rows.map((r) => ({ ...r, title: r.edition.title, slug: r.edition.slug }))}
              emptyMessage="Sem revistas neste programa. Crie a primeira edição com + Nova revista."
              columns={[
                { key: 'cityName', label: 'Cidade', render: (r) => <span className="font-medium text-white">{String(r.cityName)}</span> },
                {
                  key: 'campaignName',
                  label: 'Campanha',
                  render: (r) => (
                    <span className="text-slate-300">
                      {String(r.campaignName)}
                      {typeof r.campaignYear === 'number' ? ` · ${r.campaignYear}` : ''}
                    </span>
                  ),
                },
                {
                  key: 'title',
                  label: 'Revista',
                  render: (r) => (
                    <span>
                      <span className="block font-medium text-white">{String(r.title)}</span>
                      <code className="text-xs text-slate-500">{String(r.slug)}</code>
                    </span>
                  ),
                },
                {
                  key: 'status',
                  label: 'Estado',
                  render: (r) => (
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-slate-200">
                      {MAGAZINE_EDITION_STATUS_LABELS[r.edition.status as keyof typeof MAGAZINE_EDITION_STATUS_LABELS] ?? String(r.edition.status)}
                    </span>
                  ),
                },
                { key: 'featureCount', label: 'Destaques', render: (r) => <span className="text-slate-200">{Number(r.featureCount)}</span> },
                { key: 'publishedFeatureCount', label: 'Publicados', render: (r) => <span className="text-slate-200">{Number(r.publishedFeatureCount)}</span> },
                { key: 'updated_at', label: 'Última atualização', render: (r) => <span className="text-xs text-slate-400">{formatDate(r.edition.updated_at)}</span> },
                {
                  key: 'actions',
                  label: 'Ações',
                  render: (r) => (
                    <span className="flex flex-wrap gap-2">
                      <Link
                        to={`/admin/revistas/${r.edition.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
                      >
                        <Settings2 className="h-3 w-3" /> Gerir
                      </Link>
                      {r.edition.status !== 'published' && (
                        <button
                          onClick={() => setConfirmPublish(r.edition)}
                          disabled={!isSupabaseConfigured || actingId === r.edition.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                        >
                          <UploadCloud className="h-3 w-3" /> Publicar
                        </button>
                      )}
                      {r.edition.status !== 'archived' && (
                        <button
                          onClick={() => handleArchive(r.edition)}
                          disabled={!isSupabaseConfigured || actingId === r.edition.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-red-500/50 hover:text-red-300 disabled:opacity-40"
                        >
                          <Archive className="h-3 w-3" /> Arquivar
                        </button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          </AdminCard>
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <StatusPill active={isSupabaseConfigured} />
            {isSupabaseConfigured
              ? 'Isolamento por programa: apenas revistas do programa selecionado.'
              : 'Modo de demonstração: ligue o Supabase para gerir revistas reais.'}
          </p>
        </>
      )}

      {createOpen && (
        <Modal title={`Nova revista — ${selectedProgram?.name ?? ''}`} onClose={closeCreate} wide>
          <form onSubmit={handleCreate} className="space-y-4">
            <FormError message={formError} />
            {draftRestored && (
              <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-slate-400">
                Rascunho local recuperado — continue de onde parou. O rascunho é guardado apenas neste navegador.
              </p>
            )}
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              Programa resolvido automaticamente: <strong className="text-white">{selectedProgram?.name}</strong>.
              Estado inicial sempre <strong className="text-gold-300">rascunho</strong> — a publicação é decisão editorial posterior.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Campanha">
                <Select
                  value={form.campaign_id}
                  onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}
                  required
                >
                  <option value="">Selecionar campanha…</option>
                  {(campaignsQuery.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.year}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cidade" hint="Apenas cidades válidas do país/programa.">
                <Select value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })} required>
                  <option value="">Selecionar cidade…</option>
                  {(citiesQuery.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Título">
              <TextInput
                value={form.title}
                onChange={(e) => setForm({
                  ...form,
                  title: e.target.value,
                  slug: form.slug === '' || form.slug === slugifyEditorial(form.title) ? slugifyEditorial(e.target.value) : form.slug,
                })}
                placeholder="Ex.: The Best Europa — Braga 2026"
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Slug" hint="Gerado automaticamente, editável. Único por programa.">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="the-best-europa-braga-2026" />
              </Field>
              <Field label="Subtítulo">
                <TextInput value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="Edição oficial…" />
              </Field>
            </div>
            <Field label="Texto de abertura / apresentação">
              <TextArea value={form.introduction} onChange={(e) => setForm({ ...form, introduction: e.target.value })} rows={4} placeholder="Apresentação editorial da edição…" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField
                label="Imagem de capa"
                value={form.cover_image_url}
                onChange={(url) => setForm({ ...form, cover_image_url: url })}
                bucket="magazine-images"
                slugHint={form.slug || form.title}
                hint="Bucket magazine-images (existente). Preview imediato."
              />
              <Field label="Ordem" hint="Ordenação entre edições do programa.">
                <TextInput value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} inputMode="numeric" placeholder="0" />
              </Field>
            </div>
            <FormActions onCancel={closeCreate} saving={saving} saveLabel="Criar revista (rascunho)" />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClearDraft}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-slate-500 underline-offset-2 transition hover:text-red-300 hover:underline"
              >
                <Eraser className="h-3 w-3" /> Limpar rascunho
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmPublish && (
        <Modal title={`Publicar — ${confirmPublish.title}`} onClose={() => setConfirmPublish(null)}>
          <div className="space-y-4">
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
              {EDITION_PUBLISH_CONFIRM_TEXT}
            </p>
            <p className="text-xs text-slate-400">
              A publicação da revista NÃO publica automaticamente nenhum destaque — a edição publicada contém
              somente os destaques que individualmente estejam publicados.
            </p>
            <FormError message={null} />
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmPublish(null)}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={actingId === confirmPublish.id}
                className="rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-60"
              >
                {actingId === confirmPublish.id ? 'A publicar…' : 'Confirmar publicação'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
