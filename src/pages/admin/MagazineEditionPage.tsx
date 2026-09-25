/**
 * THE BEST EUROPA — FASE 6.4.3 — Admin > Revistas > Gerir edição.
 *
 * Rota: /admin/revistas/:editionId. Editor editorial completo de UMA
 * revista: cabeçalho (título/cidade/campanha/estado + editar/publicar/
 * arquivar), destaques editoriais (magazine_features + contexto + galeria),
 * "+ Adicionar destaque" (SOMENTE elegíveis: adoption active +
 * includes_publication, zero Meta Ads), editor do destaque com SNAPSHOTS
 * comerciais independentes, galeria relacional (magazine_images + bucket
 * magazine-images), publicação individual e perda de elegibilidade
 * fail-closed ("Elegibilidade editorial suspensa", sem apagar a feature).
 *
 * Remover da revista elimina SOMENTE magazine_feature (+ images por
 * CASCADE). NUNCA distinções, adesões, resultados, votos, certificados.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, ImagePlus, Pencil, Plus, Trash2, UploadCloud } from 'lucide-react';
import {
  EDITION_PUBLISH_CONFIRM_TEXT,
  ELIGIBILITY_SUSPENDED_LABEL,
  archiveMagazineEdition,
  createMagazineFeature,
  isFeatureEligibilitySuspended,
  prefillSnapshotsFromBusiness,
  publishMagazineEdition,
  publishMagazineFeature,
  removeFeatureFromMagazine,
  reopenMagazineEdition,
  slugifyEditorial,
  unpublishMagazineFeature,
  updateMagazineEdition,
  updateMagazineFeature,
  type AdminMagazineFeatureRow,
  type EligibleDistinctionOption,
} from '../../lib/adminMagazine';
import { addMagazineImage, removeMagazineImage } from '../../lib/magazine';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import type { MagazineFeature, MagazineImage } from '../../types/database';
import {
  useAdminMagazineEdition,
  useAdminMagazineFeatures,
  useEligibleDistinctions,
} from '../../hooks/useAdminMagazines';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Select, Toggle, Modal, FormError, FormActions, ImageField } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface EditionForm {
  title: string;
  subtitle: string;
  introduction: string;
  cover_image_url: string;
  sort_order: string;
}

interface FeatureForm {
  title: string;
  subtitle: string;
  body: string;
  cover_image_url: string;
  editorial_slug: string;
  address_snapshot: string;
  phone_snapshot: string;
  website_snapshot: string;
  instagram_snapshot: string;
  facebook_snapshot: string;
  cta_label: string;
  cta_url: string;
  show_official_seal: boolean;
  editorial_order: string;
}

const EMPTY_FEATURE: FeatureForm = {
  title: '',
  subtitle: '',
  body: '',
  cover_image_url: '',
  editorial_slug: '',
  address_snapshot: '',
  phone_snapshot: '',
  website_snapshot: '',
  instagram_snapshot: '',
  facebook_snapshot: '',
  cta_label: '',
  cta_url: '',
  show_official_seal: true,
  editorial_order: '0',
};

function featureToForm(f: MagazineFeature): FeatureForm {
  return {
    title: f.title ?? '',
    subtitle: f.subtitle ?? '',
    body: f.body ?? '',
    cover_image_url: f.cover_image_url ?? '',
    editorial_slug: f.editorial_slug ?? '',
    address_snapshot: f.address_snapshot ?? '',
    phone_snapshot: f.phone_snapshot ?? '',
    website_snapshot: f.website_snapshot ?? '',
    instagram_snapshot: f.instagram_snapshot ?? '',
    facebook_snapshot: f.facebook_snapshot ?? '',
    cta_label: f.cta_label ?? '',
    cta_url: f.cta_url ?? '',
    show_official_seal: f.show_official_seal !== false,
    editorial_order: String(f.editorial_order ?? 0),
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function MagazineEditionPage() {
  const { editionId = '' } = useParams<{ editionId: string }>();
  const editionQuery = useAdminMagazineEdition(editionId || null);
  const featuresQuery = useAdminMagazineFeatures(editionId || null);
  const eligibleQuery = useEligibleDistinctions(
    editionQuery.data ? { id: editionQuery.data.edition.id, campaign_id: editionQuery.data.edition.campaign_id, city_id: editionQuery.data.edition.city_id } : null,
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [confirmPublishEdition, setConfirmPublishEdition] = useState(false);
  const [editEditionOpen, setEditEditionOpen] = useState(false);
  const [editionForm, setEditionForm] = useState<EditionForm>({ title: '', subtitle: '', introduction: '', cover_image_url: '', sort_order: '0' });
  const [savingEdition, setSavingEdition] = useState(false);
  const [editionFormError, setEditionFormError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [selectedEligibleId, setSelectedEligibleId] = useState('');
  const [featureForm, setFeatureForm] = useState<FeatureForm>(EMPTY_FEATURE);
  const [savingFeature, setSavingFeature] = useState(false);
  const [featureFormError, setFeatureFormError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<AdminMagazineFeatureRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<AdminMagazineFeatureRow | null>(null);

  const [galleryRow, setGalleryRow] = useState<AdminMagazineFeatureRow | null>(null);
  const [gallery, setGallery] = useState<MagazineImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newCaption, setNewCaption] = useState('');

  const edition = editionQuery.data?.edition ?? null;
  const campaign = editionQuery.data?.campaign ?? null;
  const city = editionQuery.data?.city ?? null;
  const featureRows = useMemo(() => featuresQuery.data ?? [], [featuresQuery.data]);
  const eligible = useMemo(() => eligibleQuery.data ?? [], [eligibleQuery.data]);

  async function refreshAll() {
    editionQuery.refetch();
    featuresQuery.refetch();
    eligibleQuery.refetch();
  }

  /* ---------------- edição: editar / publicar / arquivar ---------------- */

  function openEditEdition() {
    if (!edition) return;
    setEditionForm({
      title: edition.title ?? '',
      subtitle: edition.subtitle ?? '',
      introduction: edition.introduction ?? '',
      cover_image_url: edition.cover_image_url ?? '',
      sort_order: String(edition.sort_order ?? 0),
    });
    setEditionFormError(null);
    setEditEditionOpen(true);
  }

  async function handleSaveEdition(e: React.FormEvent) {
    e.preventDefault();
    if (!edition) return;
    setEditionFormError(null);
    if (!editionForm.title.trim()) {
      setEditionFormError('Título obrigatório.');
      return;
    }
    setSavingEdition(true);
    try {
      const sortOrder = Number.parseInt(editionForm.sort_order.trim() || '0', 10);
      await updateMagazineEdition(
        { id: edition.id },
        {
          title: editionForm.title.trim(),
          subtitle: editionForm.subtitle.trim() || null,
          introduction: editionForm.introduction.trim() || null,
          cover_image_url: editionForm.cover_image_url.trim() || null,
          sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        },
      );
      setEditEditionOpen(false);
      editionQuery.refetch();
    } catch (err) {
      setEditionFormError(err instanceof Error ? err.message : 'Falha ao guardar a revista.');
    } finally {
      setSavingEdition(false);
    }
  }

  async function runEditionAction(kind: 'publish' | 'archive' | 'reopen') {
    if (!edition) return;
    setActionError(null);
    setActing(edition.id);
    try {
      if (kind === 'publish') await publishMagazineEdition(edition.id);
      else if (kind === 'archive') await archiveMagazineEdition(edition.id);
      else await reopenMagazineEdition(edition.id);
      setConfirmPublishEdition(false);
      editionQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha na transição editorial.');
    } finally {
      setActing(null);
    }
  }

  /* ---------------- adicionar / editar destaque ---------------- */

  function eligibleById(id: string): EligibleDistinctionOption | null {
    return eligible.find((o) => o.distinction.id === id) ?? null;
  }

  function openAdd() {
    setSelectedEligibleId('');
    setFeatureForm(EMPTY_FEATURE);
    setFeatureFormError(null);
    setAddOpen(true);
  }

  function handleSelectEligible(distinctionId: string) {
    setSelectedEligibleId(distinctionId);
    const opt = eligibleById(distinctionId);
    if (!opt) {
      setFeatureForm(EMPTY_FEATURE);
      return;
    }
    const snapshots = prefillSnapshotsFromBusiness(opt.business);
    setFeatureForm({
      ...EMPTY_FEATURE,
      title: opt.businessName,
      editorial_slug: slugifyEditorial(opt.businessSlug || opt.businessName),
      address_snapshot: snapshots.address_snapshot ?? '',
      phone_snapshot: snapshots.phone_snapshot ?? '',
      website_snapshot: snapshots.website_snapshot ?? '',
      instagram_snapshot: snapshots.instagram_snapshot ?? '',
      facebook_snapshot: snapshots.facebook_snapshot ?? '',
    });
    setFeatureFormError(null);
  }

  async function handleCreateFeature(e: React.FormEvent) {
    e.preventDefault();
    setFeatureFormError(null);
    if (!edition) return;
    const opt = eligibleById(selectedEligibleId);
    if (!opt) {
      setFeatureFormError('Selecione uma distinção elegível (adesão ativa + publicação incluída).');
      return;
    }
    if (!featureForm.title.trim() || !featureForm.editorial_slug.trim()) {
      setFeatureFormError('Título e slug editorial são obrigatórios.');
      return;
    }
    setSavingFeature(true);
    try {
      const order = Number.parseInt(featureForm.editorial_order.trim() || '0', 10);
      const result = await createMagazineFeature({
        magazine_edition_id: edition.id,
        award_distinction_id: opt.distinction.id,
        package_adoption_id: opt.adoption.id,
        editorial_slug: slugifyEditorial(featureForm.editorial_slug),
        title: featureForm.title.trim(),
        subtitle: featureForm.subtitle.trim() || null,
        body: featureForm.body.trim() || null,
        cover_image_url: featureForm.cover_image_url.trim() || null,
        address_snapshot: featureForm.address_snapshot.trim() || null,
        phone_snapshot: featureForm.phone_snapshot.trim() || null,
        website_snapshot: featureForm.website_snapshot.trim() || null,
        instagram_snapshot: featureForm.instagram_snapshot.trim() || null,
        facebook_snapshot: featureForm.facebook_snapshot.trim() || null,
        cta_label: featureForm.cta_label.trim() || null,
        cta_url: featureForm.cta_url.trim() || null,
        show_official_seal: featureForm.show_official_seal,
        editorial_order: Number.isFinite(order) ? order : 0,
      });
      if (result.duplicate) {
        throw new Error('Esta distinção já está nesta revista — não é permitido adicionar duas vezes.');
      }
      setAddOpen(false);
      refreshAll();
    } catch (err) {
      setFeatureFormError(err instanceof Error ? err.message : 'Falha ao adicionar o destaque.');
    } finally {
      setSavingFeature(false);
    }
  }

  function openEditFeature(row: AdminMagazineFeatureRow) {
    setEditingRow(row);
    setFeatureForm(featureToForm(row.feature));
    setFeatureFormError(null);
  }

  async function handleUpdateFeature(e: React.FormEvent) {
    e.preventDefault();
    if (!editingRow) return;
    setFeatureFormError(null);
    if (!featureForm.title.trim() || !featureForm.editorial_slug.trim()) {
      setFeatureFormError('Título e slug editorial são obrigatórios.');
      return;
    }
    setSavingFeature(true);
    try {
      const order = Number.parseInt(featureForm.editorial_order.trim() || '0', 10);
      await updateMagazineFeature(
        { id: editingRow.feature.id },
        {
          title: featureForm.title.trim(),
          editorial_slug: slugifyEditorial(featureForm.editorial_slug),
          subtitle: featureForm.subtitle.trim() || null,
          body: featureForm.body.trim() || null,
          cover_image_url: featureForm.cover_image_url.trim() || null,
          address_snapshot: featureForm.address_snapshot.trim() || null,
          phone_snapshot: featureForm.phone_snapshot.trim() || null,
          website_snapshot: featureForm.website_snapshot.trim() || null,
          instagram_snapshot: featureForm.instagram_snapshot.trim() || null,
          facebook_snapshot: featureForm.facebook_snapshot.trim() || null,
          cta_label: featureForm.cta_label.trim() || null,
          cta_url: featureForm.cta_url.trim() || null,
          show_official_seal: featureForm.show_official_seal,
          editorial_order: Number.isFinite(order) ? order : 0,
        },
      );
      setEditingRow(null);
      featuresQuery.refetch();
    } catch (err) {
      setFeatureFormError(err instanceof Error ? err.message : 'Falha ao guardar o destaque.');
    } finally {
      setSavingFeature(false);
    }
  }

  /* ---------------- publicar / despublicar / remover destaque ---------------- */

  async function handlePublishFeature(row: AdminMagazineFeatureRow) {
    // Fail-closed §12: nunca (re)publicar enquanto inelegível.
    if (isFeatureEligibilitySuspended({ adoption: row.adoption, awardStatus: row.awardStatus })) {
      setActionError(`"${row.feature.title}": ${ELIGIBILITY_SUSPENDED_LABEL} — publicação recusada. A feature é preservada.`);
      return;
    }
    setActionError(null);
    setActing(row.feature.id);
    try {
      await publishMagazineFeature(row.feature.id);
      featuresQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao publicar o destaque.');
    } finally {
      setActing(null);
    }
  }

  async function handleUnpublishFeature(row: AdminMagazineFeatureRow) {
    setActionError(null);
    setActing(row.feature.id);
    try {
      await unpublishMagazineFeature(row.feature.id);
      featuresQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao despublicar o destaque.');
    } finally {
      setActing(null);
    }
  }

  async function handleRemoveFeature() {
    if (!confirmRemove) return;
    setActionError(null);
    setActing(confirmRemove.feature.id);
    try {
      await removeFeatureFromMagazine(confirmRemove.feature.id);
      setConfirmRemove(null);
      refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao remover o destaque.');
    } finally {
      setActing(null);
    }
  }

  /* ---------------- galeria relacional ---------------- */

  async function openGallery(row: AdminMagazineFeatureRow) {
    setGalleryRow(row);
    setGallery([]);
    setGalleryError(null);
    setNewImageUrl('');
    setNewCaption('');
    if (!supabase) {
      setGalleryError('Supabase por configurar — galeria indisponível em demonstração.');
      return;
    }
    setGalleryLoading(true);
    try {
      const { data, error } = await supabase
        .from('magazine_images')
        .select('*')
        .eq('magazine_feature_id', row.feature.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      setGallery((data ?? []) as MagazineImage[]);
    } catch (err) {
      setGalleryError(err instanceof Error ? err.message : 'Falha ao carregar a galeria.');
    } finally {
      setGalleryLoading(false);
    }
  }

  async function handleAddImage(e: React.FormEvent) {
    e.preventDefault();
    if (!galleryRow) return;
    setGalleryError(null);
    if (!newImageUrl.trim()) {
      setGalleryError('URL da imagem obrigatório (ou use o upload para magazine-images).');
      return;
    }
    try {
      const maxOrder = gallery.reduce((m, g) => Math.max(m, g.sort_order ?? 0), -1);
      await addMagazineImage({
        magazine_feature_id: galleryRow.feature.id,
        image_url: newImageUrl.trim(),
        caption: newCaption.trim() || null,
        sort_order: maxOrder + 1,
      });
      setNewImageUrl('');
      setNewCaption('');
      await openGalleryRefresh(galleryRow.feature.id);
      featuresQuery.refetch();
    } catch (err) {
      setGalleryError(err instanceof Error ? err.message : 'Falha ao adicionar a imagem.');
    }
  }

  async function openGalleryRefresh(featureId: string) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('magazine_images')
      .select('*')
      .eq('magazine_feature_id', featureId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    setGallery((data ?? []) as MagazineImage[]);
  }

  async function handleRemoveImage(img: MagazineImage) {
    setGalleryError(null);
    try {
      await removeMagazineImage({ id: img.id, magazine_feature_id: img.magazine_feature_id });
      setGallery((prev) => prev.filter((g) => g.id !== img.id));
      featuresQuery.refetch();
    } catch (err) {
      setGalleryError(err instanceof Error ? err.message : 'Falha ao remover a imagem.');
    }
  }

  async function handleMoveImage(img: MagazineImage, direction: -1 | 1) {
    if (!supabase) return;
    const sorted = [...gallery].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = sorted.findIndex((g) => g.id === img.id);
    const swapWith = sorted[idx + direction];
    if (idx < 0 || !swapWith) return;
    setGalleryError(null);
    try {
      const aOrder = img.sort_order ?? 0;
      const bOrder = swapWith.sort_order ?? 0;
      const { error: e1 } = await supabase.from('magazine_images').update({ sort_order: bOrder }).eq('id', img.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('magazine_images').update({ sort_order: aOrder }).eq('id', swapWith.id);
      if (e2) throw e2;
      await openGalleryRefresh(img.magazine_feature_id);
    } catch (err) {
      setGalleryError(err instanceof Error ? err.message : 'Falha ao reordenar a galeria.');
    }
  }

  if (editionQuery.loading) return <PageLoading label="A carregar revista…" />;
  if (editionQuery.error || !edition) {
    return (
      <div>
        <Link to="/admin/revistas" className="mb-4 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-gold-300">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar às revistas
        </Link>
        <ErrorState message={editionQuery.error ?? 'Revista não encontrada.'} onRetry={editionQuery.refetch} />
      </div>
    );
  }

  const selectedOpt = selectedEligibleId ? eligibleById(selectedEligibleId) : null;
  const publishedCount = featureRows.filter((r) => r.feature.is_published).length;

  return (
    <div>
      <Link to="/admin/revistas" className="mb-4 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-gold-300">
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar às revistas
      </Link>
      <AdminHeader
        title={edition.title}
        description={`${city?.name ?? '—'} · ${campaign?.name ?? '—'}${typeof campaign?.year === 'number' ? ` (${campaign.year})` : ''} · Estado: ${edition.status} · ${featureRows.length} destaques (${publishedCount} publicados). A revista NÃO é resultado eleitoral.`}
        actions={
          <>
            <button
              onClick={openEditEdition}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:border-gold-500/50 hover:text-gold-300"
            >
              <Pencil className="h-4 w-4" /> Editar revista
            </button>
            {edition.status !== 'published' ? (
              <button
                onClick={() => setConfirmPublishEdition(true)}
                disabled={!isSupabaseConfigured || acting === edition.id}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gold-gradient px-3.5 py-2 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
              >
                <UploadCloud className="h-4 w-4" /> Publicar revista
              </button>
            ) : (
              <button
                onClick={() => runEditionAction('archive')}
                disabled={!isSupabaseConfigured || acting === edition.id}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
              >
                <Archive className="h-4 w-4" /> Arquivar revista
              </button>
            )}
          </>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner />
      {actionError && (
        <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
          {actionError}
        </p>
      )}

      {edition.cover_image_url && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-white/10">
          <img src={edition.cover_image_url} alt={`Capa — ${edition.title}`} className="max-h-64 w-full object-cover" />
        </div>
      )}
      {edition.introduction && (
        <p className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-slate-300">
          {edition.introduction}
        </p>
      )}

      <AdminCard
        title={`Destaques editoriais (${featureRows.length})`}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Remover da revista elimina SOMENTE o destaque e as suas imagens — nunca distinções, adesões, votos ou certificados.
          </p>
          <button
            onClick={openAdd}
            disabled={!isSupabaseConfigured}
            className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Adicionar destaque
          </button>
        </div>
        {featuresQuery.error && featureRows.length === 0 ? (
          <ErrorState message={featuresQuery.error} onRetry={featuresQuery.refetch} />
        ) : (
          <AdminTable
            searchable
            searchKeys={['businessName', 'categoryName', 'modalityName']}
            searchPlaceholder="Pesquisar destaques…"
            rows={featureRows}
            emptyMessage="Sem destaques nesta revista. Adicione vencedores elegíveis com + Adicionar destaque."
            columns={[
              { key: 'businessName', label: 'Empresa', render: (r) => <span className="font-medium text-white">{String(r.businessName)}</span> },
              { key: 'categoryName', label: 'Categoria', render: (r) => <span className="text-slate-300">{String(r.categoryName)}</span> },
              { key: 'areaName', label: 'Área', render: (r) => <span className="text-slate-400">{r.areaName ? String(r.areaName) : '—'}</span> },
              { key: 'modalityName', label: 'Modalidade', render: (r) => <span className="text-slate-300">{String(r.modalityName)}</span> },
              {
                key: 'title',
                label: 'Título editorial',
                render: (r) => (
                  <span>
                    <span className="block max-w-56 truncate font-medium text-white" title={r.feature.title}>{r.feature.title}</span>
                    <code className="text-xs text-slate-500">{r.feature.editorial_slug}</code>
                  </span>
                ),
              },
              {
                key: 'editorial',
                label: 'Estado editorial',
                render: (r) => (
                  <span className="flex flex-col gap-1">
                    <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${r.feature.is_published ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-300'}`}>
                      {r.feature.is_published ? 'Publicado' : 'Rascunho'}
                    </span>
                    {r.eligibilitySuspended && (
                      <span className="inline-flex w-fit items-center rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-300">
                        {ELIGIBILITY_SUSPENDED_LABEL}
                      </span>
                    )}
                  </span>
                ),
              },
              { key: 'editorial_order', label: 'Ordem', render: (r) => <span className="text-slate-200">{Number(r.feature.editorial_order ?? 0)}</span> },
              { key: 'imageCount', label: 'Imagens', render: (r) => <span className="text-slate-200">{Number(r.imageCount)}</span> },
              {
                key: 'actions',
                label: 'Ações',
                render: (r) => (
                  <span className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => openEditFeature(r)}
                      className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => openGallery(r)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300"
                    >
                      <ImagePlus className="h-3 w-3" /> Imagens
                    </button>
                    {r.feature.is_published ? (
                      <button
                        onClick={() => handleUnpublishFeature(r)}
                        disabled={acting === r.feature.id}
                        className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40"
                      >
                        Despublicar
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePublishFeature(r)}
                        disabled={acting === r.feature.id || r.eligibilitySuspended}
                        title={r.eligibilitySuspended ? ELIGIBILITY_SUSPENDED_LABEL : 'Publicar destaque'}
                        className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40"
                      >
                        Publicar
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmRemove(r)}
                      disabled={acting === r.feature.id}
                      title="Remover da revista (só o destaque + imagens)"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300 hover:border-red-500/50 hover:text-red-300 disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </AdminCard>

      {/* ---------- editar revista ---------- */}
      {editEditionOpen && (
        <Modal title={`Editar revista — ${edition.title}`} onClose={() => setEditEditionOpen(false)} wide>
          <form onSubmit={handleSaveEdition} className="space-y-4">
            <FormError message={editionFormError} />
            <Field label="Título">
              <TextInput value={editionForm.title} onChange={(e) => setEditionForm({ ...editionForm, title: e.target.value })} required />
            </Field>
            <Field label="Subtítulo">
              <TextInput value={editionForm.subtitle} onChange={(e) => setEditionForm({ ...editionForm, subtitle: e.target.value })} />
            </Field>
            <Field label="Texto de abertura / apresentação">
              <TextArea value={editionForm.introduction} onChange={(e) => setEditionForm({ ...editionForm, introduction: e.target.value })} rows={4} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField
                label="Imagem de capa"
                value={editionForm.cover_image_url}
                onChange={(url) => setEditionForm({ ...editionForm, cover_image_url: url })}
                bucket="magazine-images"
                slugHint={edition.slug}
              />
              <Field label="Ordem">
                <TextInput value={editionForm.sort_order} onChange={(e) => setEditionForm({ ...editionForm, sort_order: e.target.value })} inputMode="numeric" />
              </Field>
            </div>
            <FormActions onCancel={() => setEditEditionOpen(false)} saving={savingEdition} />
          </form>
        </Modal>
      )}

      {/* ---------- confirmar publicação da edição ---------- */}
      {confirmPublishEdition && (
        <Modal title={`Publicar — ${edition.title}`} onClose={() => setConfirmPublishEdition(false)}>
          <div className="space-y-4">
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
              {EDITION_PUBLISH_CONFIRM_TEXT}
            </p>
            <p className="text-xs text-slate-400">
              Não publica automaticamente nenhum destaque. A revista publicada contém somente os destaques
              que individualmente estejam publicados.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmPublishEdition(false)}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => runEditionAction('publish')}
                disabled={acting === edition.id}
                className="rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-60"
              >
                {acting === edition.id ? 'A publicar…' : 'Confirmar publicação'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---------- adicionar destaque (somente elegíveis) ---------- */}
      {addOpen && (
        <Modal title={`Adicionar destaque — ${edition.title}`} onClose={() => setAddOpen(false)} wide>
          <form onSubmit={handleCreateFeature} className="space-y-4">
            <FormError message={featureFormError} />
            {eligibleQuery.loading ? (
              <p className="text-sm text-slate-400">A carregar distinções elegíveis…</p>
            ) : eligibleQuery.error ? (
              <ErrorState message={eligibleQuery.error} onRetry={eligibleQuery.refetch} />
            ) : eligible.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-navy-950/60 p-4 text-sm text-slate-400">
                Sem distinções elegíveis: exige distinção existente + adesão ativa com publicação incluída
                (includes_publication). Meta Ads nunca condiciona a revista.
              </p>
            ) : (
              <Field label="Distinção elegível" hint="Somente adesões ativas com publicação incluída.">
                <Select value={selectedEligibleId} onChange={(e) => handleSelectEligible(e.target.value)} required>
                  <option value="">Selecionar vencedor…</option>
                  {eligible.map((o) => (
                    <option key={o.distinction.id} value={o.distinction.id}>
                      {o.businessName} · {o.categoryName} · {o.modalityName}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {selectedOpt && (
              <div className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
                <p><strong className="text-white">{selectedOpt.businessName}</strong> · {selectedOpt.categoryName}{selectedOpt.areaName ? ` · ${selectedOpt.areaName}` : ''} · {selectedOpt.modalityName}</p>
                <p className="mt-1">Distinção editorial: snapshots pré-preenchidos da empresa — depois independentes na revista.</p>
              </div>
            )}
            <FeatureEditorFields form={featureForm} setForm={setFeatureForm} slugSource={selectedOpt?.businessName ?? ''} />
            <FormActions onCancel={() => setAddOpen(false)} saving={savingFeature} saveLabel="Adicionar destaque (rascunho)" />
          </form>
        </Modal>
      )}

      {/* ---------- editar destaque ---------- */}
      {editingRow && (
        <Modal title={`Editar destaque — ${editingRow.businessName}`} onClose={() => setEditingRow(null)} wide>
          <form onSubmit={handleUpdateFeature} className="space-y-4">
            <FormError message={featureFormError} />
            <div className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              <p>Empresa: <strong className="text-white">{editingRow.businessName}</strong> · Categoria: <strong className="text-white">{editingRow.categoryName}</strong>{editingRow.areaName ? ` · Área: ${editingRow.areaName}` : ''} · Modalidade: <strong className="text-white">{editingRow.modalityName}</strong></p>
              {editingRow.eligibilitySuspended && (
                <p className="mt-1 font-medium text-red-300">{ELIGIBILITY_SUSPENDED_LABEL} — a feature é preservada; nova publicação bloqueada.</p>
              )}
            </div>
            <FeatureEditorFields form={featureForm} setForm={setFeatureForm} slugSource="" />
            <FormActions onCancel={() => setEditingRow(null)} saving={savingFeature} />
          </form>
        </Modal>
      )}

      {/* ---------- remover destaque ---------- */}
      {confirmRemove && (
        <Modal title={`Remover da revista — ${confirmRemove.businessName}`} onClose={() => setConfirmRemove(null)}>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-300">
              Remove SOMENTE o destaque editorial <strong className="text-white">“{confirmRemove.feature.title}”</strong> e
              as suas {confirmRemove.imageCount} imagens da revista.
            </p>
            <p className="rounded-xl border border-white/10 bg-navy-950/60 p-3 text-xs text-slate-400">
              NUNCA remove a distinção, cancela a adesão, altera resultados/votos, revoga certificados ou altera o estado comercial.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRemoveFeature}
                disabled={acting === confirmRemove.feature.id}
                className="rounded-xl border border-red-500/50 bg-red-500/15 px-6 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/25 disabled:opacity-60"
              >
                {acting === confirmRemove.feature.id ? 'A remover…' : 'Remover da revista'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---------- galeria ---------- */}
      {galleryRow && (
        <Modal title={`Galeria — ${galleryRow.businessName}`} onClose={() => setGalleryRow(null)} wide>
          <div className="space-y-4">
            <FormError message={galleryError} />
            {galleryLoading ? (
              <p className="text-sm text-slate-400">A carregar galeria…</p>
            ) : gallery.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 py-8 text-center text-sm text-slate-500">
                Sem imagens. Adicione a primeira abaixo (bucket magazine-images; linhas relacionais, nunca JSON).
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {[...gallery].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((img) => (
                  <li key={img.id} className="overflow-hidden rounded-xl border border-white/10 bg-navy-950/60">
                    <img src={img.image_url} alt={img.caption ?? 'Imagem da galeria'} className="h-36 w-full object-cover" />
                    <div className="space-y-2 p-3">
                      <p className="truncate text-xs text-slate-300" title={img.caption ?? ''}>{img.caption || 'Sem legenda'}</p>
                      <p className="text-[11px] text-slate-500">Ordem {img.sort_order}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => handleMoveImage(img, -1)} className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:border-gold-500/50 hover:text-gold-300">↑ Subir</button>
                        <button type="button" onClick={() => handleMoveImage(img, 1)} className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:border-gold-500/50 hover:text-gold-300">↓ Descer</button>
                        <button type="button" onClick={() => handleRemoveImage(img)} className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:border-red-500/50 hover:text-red-300">Remover</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleAddImage} className="space-y-3 rounded-xl border border-white/10 bg-navy-950/40 p-4">
              <ImageField
                label="Nova imagem (upload magazine-images ou URL)"
                value={newImageUrl}
                onChange={setNewImageUrl}
                bucket="magazine-images"
                slugHint={galleryRow.feature.editorial_slug}
                hint="Guarda UMA linha em magazine_images (relacional)."
              />
              <Field label="Legenda">
                <TextInput value={newCaption} onChange={(e) => setNewCaption(e.target.value)} placeholder="Legenda da imagem…" />
              </Field>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-4 py-2 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110"
              >
                <ImagePlus className="h-4 w-4" /> Adicionar imagem
              </button>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Campos editoriais do destaque (snapshots comerciais independentes). */
function FeatureEditorFields({
  form,
  setForm,
  slugSource,
}: {
  form: FeatureForm;
  setForm: (f: FeatureForm) => void;
  slugSource: string;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título editorial">
          <TextInput
            value={form.title}
            onChange={(e) => setForm({
              ...form,
              title: e.target.value,
              editorial_slug: form.editorial_slug === '' || (slugSource !== '' && form.editorial_slug === slugifyEditorial(form.title)) ? slugifyEditorial(e.target.value) : form.editorial_slug,
            })}
            placeholder="A história do negócio…"
            required
          />
        </Field>
        <Field label="Slug editorial" hint="Único dentro da edição.">
          <TextInput value={form.editorial_slug} onChange={(e) => setForm({ ...form, editorial_slug: e.target.value })} required />
        </Field>
      </div>
      <Field label="Subtítulo">
        <TextInput value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="Subtítulo…" />
      </Field>
      <Field label="Texto editorial / história do negócio">
        <TextArea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} placeholder="História do negócio, equipa, especialidades…" />
      </Field>
      <ImageField
        label="Imagem principal / cover"
        value={form.cover_image_url}
        onChange={(url) => setForm({ ...form, cover_image_url: url })}
        bucket="magazine-images"
        slugHint={form.editorial_slug || form.title}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Morada (snapshot)" hint="Cópia editorial — não segue alterações futuras da empresa.">
          <TextInput value={form.address_snapshot} onChange={(e) => setForm({ ...form, address_snapshot: e.target.value })} />
        </Field>
        <Field label="Telefone (snapshot)">
          <TextInput value={form.phone_snapshot} onChange={(e) => setForm({ ...form, phone_snapshot: e.target.value })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Website (snapshot)">
          <TextInput value={form.website_snapshot} onChange={(e) => setForm({ ...form, website_snapshot: e.target.value })} inputMode="url" />
        </Field>
        <Field label="Instagram (snapshot)">
          <TextInput value={form.instagram_snapshot} onChange={(e) => setForm({ ...form, instagram_snapshot: e.target.value })} />
        </Field>
        <Field label="Facebook (snapshot)">
          <TextInput value={form.facebook_snapshot} onChange={(e) => setForm({ ...form, facebook_snapshot: e.target.value })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CTA — texto do botão">
          <TextInput value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} placeholder="Ex.: Visitar website" />
        </Field>
        <Field label="CTA — URL">
          <TextInput value={form.cta_url} onChange={(e) => setForm({ ...form, cta_url: e.target.value })} inputMode="url" placeholder="https://…" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Toggle checked={form.show_official_seal} onChange={(v) => setForm({ ...form, show_official_seal: v })} label="Mostrar selo oficial" />
        <Field label="Ordem editorial">
          <TextInput value={form.editorial_order} onChange={(e) => setForm({ ...form, editorial_order: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
    </>
  );
}
