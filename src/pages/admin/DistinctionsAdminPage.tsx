/**
 * THE BEST EUROPA — FASE 5C.3.11 + 5C.3.12 — Admin > Distinções.
 *
 * Ferramenta operacional pós-votação SEM manipular o resultado oficial:
 *  - Colunas separadas: EMPRESA / CIDADE / CATEGORIA / MODALIDADE / POSIÇÃO
 *    (via get_admin_modality_tally) / ORIGEM / MÉRITO (award_status) /
 *    ESTADO COMERCIAL (commercial_status) / RECONHECIMENTO (fulfillment) /
 *    NOTAS / ÚLTIMA ATUALIZAÇÃO.
 *  - award_status (mérito), commercial_status (relação comercial) e
 *    fulfillment (reconhecimento/entrega, 5C.3.12) são dimensões
 *    INDEPENDENTES. Fulfillment NUNCA altera mérito, comercial, votos,
 *    rankings, vencedores ou resultados públicos.
 *  - commercial_status = declined mostra "Recusou a distinção" mas preserva
 *    empresa, modalidade, posição, award_status, votos e histórico. NUNCA
 *    altera mérito, votos, rankings ou cria outra distinção.
 *  - Pipeline comercial (CRM simples, SEM pagamento):
 *      Pendente → Contactado → Aceite → Confirmado,
 *      Pendente/Contactado → Recusado, qualquer → Cancelado.
 *  - Reconhecimento (5C.3.12, SEM pagamentos, SEM gerador de PDF/imagem):
 *      Certificado · Selo digital · Placa · Troféu, cada um com estado
 *      Pendente|Em preparação|Pronto|Entregue|Cancelado + notas
 *      administrativas (nunca públicas) + entrega simples para físicos
 *      (Levantamento|Entrega|Evento + tracking + delivered_at).
 *  - Ações rápidas usam SOMENTE updateCommercialStatus (auditado);
 *    reconhecimento usa SOMENTE a lib fulfillment (auditada).
 *
 * Scope: AdminProgramProvider (única fonte) — programa + país + edição.
 * FAIL-CLOSED: sem programa válido → sem dados; sem edição válida →
 * sem criar/alterar distinções ou reconhecimento.
 *
 * SEM monetização, SEM seeds, SEM 2027, SEM novo país/programa.
 * NÃO toca em votes / vote_attempts / vote_adjustments / modality_votes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, PackageCheck, PhoneCall, StickyNote } from 'lucide-react';
import {
  useScopedBusinesses,
  useScopedCategories,
  useScopedCities,
  useScopedCredentials,
  useScopedDistinctions,
  useScopedFulfillment,
  useScopedModalities,
} from '../../hooks/useAdminData';
import { useScopedPackageAdoptions } from '../../hooks/usePackageAdoptions';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  AWARD_STATUSES,
  AWARD_STATUS_LABELS,
  COMMERCIAL_QUICK_ACTIONS,
  COMMERCIAL_STATUSES,
  COMMERCIAL_STATUS_LABELS,
  SOURCE_LABELS,
  comboKey,
  createDistinction,
  nextCommercialTransitions,
  tallyKey,
  updateAwardStatus,
  updateCommercialStatus,
  updateDistinctionNotes,
} from '../../lib/distinctions';
import {
  FULFILLMENT_DELIVERY_LABELS,
  FULFILLMENT_DELIVERY_METHODS,
  FULFILLMENT_ITEM_LABELS,
  FULFILLMENT_ITEM_TYPES,
  FULFILLMENT_STATUS_LABELS,
  FULFILLMENT_STATUSES,
  createFulfillmentItem,
  fulfillmentCompactLabel,
  fulfillmentEligibilityHint,
  isPhysicalFulfillmentItem,
  removeFulfillmentItem,
  summarizeFulfillment,
  updateFulfillmentItem,
} from '../../lib/fulfillment';
import {
  META_ADS_COLLECTIVE_NOTICE,
  PACKAGE_ADOPTION_STATUS_LABELS,
  PACKAGE_NON_INTERFERENCE_NOTICE,
  PILOT_DIGITAL_PACKAGE,
  cancelPackageAdoption,
  createPackageAdoption,
  formatPriceCents,
  reactivatePackageAdoption,
} from '../../lib/packages';
import {
  DIGITAL_CREDENTIAL_STATUS_LABELS,
  DIGITAL_CREDENTIAL_TYPE_LABELS,
  activeCredential,
  credentialHistory,
  issueCredential,
  revokeCredential,
  verificationUrl,
} from '../../lib/digitalCredentials';
import {
  certificateFilename,
  resolveCredentialDisplayData,
  sealFilename,
  type CredentialDisplayData,
} from '../../lib/credentialData';
import {
  downloadCertificatePdf,
  downloadSealPng,
} from '../../lib/credentialRenderer';
import { CredentialPreview, type CredentialPreviewKind } from '../../components/CredentialPreview';
import type {
  AwardDistinction,
  AwardStatus,
  CommercialStatus,
  DigitalCredential,
  DigitalCredentialType,
  DistinctionFulfillment,
  DistinctionPackageAdoption,
  FulfillmentDeliveryMethod,
  FulfillmentItemType,
  FulfillmentStatus,
} from '../../types/database';
import {
  AdminHeader,
  AdminCard,
  AdminTable,
  SupabaseNotice,
} from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import {
  Field,
  Select,
  TextInput,
  TextArea,
  Modal,
  FormError,
  FormActions,
} from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface TallyEntry {
  position: number;
  total_votes: number;
}

interface ConfirmState {
  city_id: string;
  category_id: string;
  modality_id: string;
  business_id: string;
  business_name: string;
  position: number;
  total_votes: number;
}

function pillClass(kind: 'award' | 'commercial' | 'source' | 'fulfillment', value: string): string {
  if (kind === 'source') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
  }
  if (kind === 'fulfillment') {
    if (value === 'delivered') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    if (value === 'ready') return 'border-teal-500/30 bg-teal-500/10 text-teal-200';
    if (value === 'preparing') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    if (value === 'cancelled') return 'border-red-500/30 bg-red-500/10 text-red-200';
    return 'border-white/15 bg-white/5 text-slate-300';
  }
  const emerald = ['confirmed', 'winner', 'accepted'];
  const amber = ['selected', 'contacted'];
  const red = ['declined', 'cancelled'];
  if (emerald.includes(value)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (amber.includes(value)) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (red.includes(value)) return 'border-red-500/30 bg-red-500/10 text-red-200';
  return 'border-white/15 bg-white/5 text-slate-300';
}

/* ---------------------------------------------------------------------------
 * FASE 5C.3.12 — Gestor de reconhecimento/entrega (modal por distinção).
 * Permite selecionar [ ] Certificado [ ] Selo digital [ ] Placa [ ] Troféu;
 * para cada item: estado, notas administrativas, método de entrega +
 * tracking + delivered_at (físicos), última atualização. NÃO gera PDF/imagem,
 * NÃO altera mérito/comercial/votos/ranking — escreve SOMENTE em
 * distinction_fulfillment via lib fulfillment (auditada). Fail-closed: sem
 * edição válida → escrita bloqueada.
 * ------------------------------------------------------------------------- */

function FulfillmentManager({
  distinction,
  businessName,
  items,
  hasCampaign,
  onChanged,
  onClose,
}: {
  distinction: AwardDistinction;
  businessName: string;
  items: DistinctionFulfillment[];
  hasCampaign: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const byType = useMemo(() => {
    const m = new Map<FulfillmentItemType, DistinctionFulfillment>();
    for (const it of items) m.set(it.item_type, it);
    return m;
  }, [items]);
  const [selected, setSelected] = useState<Record<FulfillmentItemType, boolean>>(() => ({
    certificate: byType.has('certificate'),
    digital_seal: byType.has('digital_seal'),
    plaque: byType.has('plaque'),
    trophy: byType.has('trophy'),
  }));
  const [drafts, setDrafts] = useState<
    Record<
      FulfillmentItemType,
      {
        status: FulfillmentStatus;
        notes: string;
        delivery_method: '' | FulfillmentDeliveryMethod;
        tracking_reference: string;
        delivered_at: string;
      }
    >
  >(() => {
    const mk = (t: FulfillmentItemType) => {
      const ex = byType.get(t);
      return {
        status: ex?.status ?? ('pending' as FulfillmentStatus),
        notes: ex?.notes ?? '',
        delivery_method: (ex?.delivery_method ?? '') as '' | FulfillmentDeliveryMethod,
        tracking_reference: ex?.tracking_reference ?? '',
        delivered_at: ex?.delivered_at ? String(ex.delivered_at).slice(0, 16) : '',
      };
    };
    return {
      certificate: mk('certificate'),
      digital_seal: mk('digital_seal'),
      plaque: mk('plaque'),
      trophy: mk('trophy'),
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const eligibilityHint = fulfillmentEligibilityHint(distinction);

  function toggle(t: FulfillmentItemType, v: boolean) {
    setSelected((s) => ({ ...s, [t]: v }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!hasCampaign) {
      setError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    setSaving(true);
    try {
      // Para cada tipo: selecionado sem registo → INSERT; selecionado com
      // registo → UPDATE; desselecionado com registo → DELETE (remoção
      // estrutural; preferir estado Cancelado quando for só operacional).
      for (const t of FULFILLMENT_ITEM_TYPES) {
        const existing = byType.get(t);
        const want = selected[t];
        const d = drafts[t];
        if (want && !existing) {
          const physical = isPhysicalFulfillmentItem(t);
          const res = await createFulfillmentItem({
            award_distinction_id: distinction.id,
            item_type: t,
            status: d.status,
            notes: d.notes.trim() === '' ? null : d.notes.trim(),
            delivery_method: physical && d.delivery_method !== '' ? d.delivery_method : null,
            tracking_reference: physical && d.tracking_reference.trim() !== '' ? d.tracking_reference.trim() : null,
            delivered_at:
              d.status === 'delivered' && d.delivered_at !== ''
                ? new Date(d.delivered_at).toISOString()
                : null,
          });
          if (res.duplicate) {
            await updateFulfillmentItem(
              { id: (byType.get(t)?.id ?? '') as string },
              {},
            ).catch(() => undefined);
          }
        } else if (want && existing) {
          const physical = isPhysicalFulfillmentItem(t);
          await updateFulfillmentItem(
            { id: existing.id },
            {
              status: d.status,
              notes: d.notes.trim() === '' ? null : d.notes.trim(),
              delivery_method: physical ? (d.delivery_method === '' ? null : d.delivery_method) : null,
              tracking_reference:
                physical ? (d.tracking_reference.trim() === '' ? null : d.tracking_reference.trim()) : null,
              delivered_at:
                d.status === 'delivered' && d.delivered_at !== ''
                  ? new Date(d.delivered_at).toISOString()
                  : d.status === 'delivered'
                    ? existing.delivered_at
                    : null,
            },
          );
        } else if (!want && existing) {
          await removeFulfillmentItem({
            id: existing.id,
            award_distinction_id: existing.award_distinction_id,
            item_type: existing.item_type,
          });
        }
      }
      setInfo('Reconhecimento guardado. Mérito, relação comercial, votos e ranking inalterados.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao guardar o reconhecimento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Gerir reconhecimento — ${businessName}`} onClose={onClose} wide>
      <form onSubmit={handleSave} className="space-y-4">
        <FormError message={error} />
        {info && (
          <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
            {info}
          </p>
        )}
        {eligibilityHint && (
          <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200">
            {eligibilityHint} O reconhecimento é apenas operacional e nunca altera os outros estados.
          </p>
        )}
        <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs leading-relaxed text-slate-400">
          Controlo administrativo (sem gerador de PDF/imagem): assinale os itens aplicáveis. Cada item tem estado
          próprio (Pendente · Em preparação · Pronto · Entregue · Cancelado) e notas administrativas — nunca públicas.
          Placa e Troféu aceitam dados de entrega (Levantamento · Entrega · Evento + referência + data).
        </p>
        <div className="space-y-3">
          {FULFILLMENT_ITEM_TYPES.map((t) => {
            const existing = byType.get(t);
            const d = drafts[t];
            const physical = isPhysicalFulfillmentItem(t);
            return (
              <fieldset key={t} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected[t]}
                    onChange={(e) => toggle(t, e.target.checked)}
                    className="h-4 w-4 accent-yellow-500"
                  />
                  <span className="text-sm font-semibold text-white">{FULFILLMENT_ITEM_LABELS[t]}</span>
                  {existing && (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pillClass('fulfillment', existing.status)}`}>
                      {FULFILLMENT_STATUS_LABELS[existing.status]}
                    </span>
                  )}
                  {!physical && (
                    <span className="text-[11px] text-slate-500">(controlo administrativo — sem ficheiro gerado)</span>
                  )}
                </label>
                {selected[t] && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Estado">
                      <Select
                        value={d.status}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t]: { ...prev[t], status: e.target.value as FulfillmentStatus },
                          }))
                        }
                      >
                        {FULFILLMENT_STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-navy-900">
                            {FULFILLMENT_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Data de entrega (quando aplicável)">
                      <TextInput
                        type="datetime-local"
                        value={d.delivered_at}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [t]: { ...prev[t], delivered_at: e.target.value },
                          }))
                        }
                      />
                    </Field>
                    {physical && (
                      <>
                        <Field label="Método de entrega">
                          <Select
                            value={d.delivery_method}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [t]: {
                                  ...prev[t],
                                  delivery_method: e.target.value as '' | FulfillmentDeliveryMethod,
                                },
                              }))
                            }
                          >
                            <option value="" className="bg-navy-900">— Não aplicável —</option>
                            {FULFILLMENT_DELIVERY_METHODS.map((m) => (
                              <option key={m} value={m} className="bg-navy-900">
                                {FULFILLMENT_DELIVERY_LABELS[m]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Referência de entrega (tracking)">
                          <TextInput
                            value={d.tracking_reference}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [t]: { ...prev[t], tracking_reference: e.target.value },
                              }))
                            }
                            placeholder="Ex.: EVENTO-2026-014"
                          />
                        </Field>
                      </>
                    )}
                    <div className={physical ? 'sm:col-span-2' : 'sm:col-span-2'}>
                      <Field label="Notas administrativas (nunca públicas)">
                        <TextArea
                          value={d.notes}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [t]: { ...prev[t], notes: e.target.value },
                            }))
                          }
                          rows={2}
                          placeholder={
                            t === 'plaque'
                              ? 'Ex.: Placa enviada para produção'
                              : t === 'certificate'
                                ? 'Ex.: Certificado conferido'
                                : t === 'digital_seal'
                                  ? 'Ex.: Selo digital pronto a enviar'
                                  : 'Ex.: Entrega prevista no evento'
                          }
                        />
                      </Field>
                    </div>
                    {existing && (
                      <p className="text-[11px] text-slate-500 sm:col-span-2">
                        Última atualização: {new Date(String(existing.updated_at)).toLocaleString('pt-PT')}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>
        <FormActions onCancel={onClose} saving={saving} saveLabel="Guardar reconhecimento" />
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * FASE 5C.3.13 — Gestor de credenciais verificáveis (modal por distinção).
 * Para certificate + digital_seal: GERAR CREDENCIAL (valida programa,
 * campanha, distinção, fulfillment correspondente e elegibilidade; gera
 * código seguro TBE-PT-<ANO>-…; persiste; audita) / VERIFICAR (abre rota
 * pública) / REVOGAR (confirmação explícita + motivo obrigatório;
 * preserva registo, nunca DELETE). NÃO altera award_status,
 * commercial_status, fulfillment status, votos, ranking ou resultados —
 * só UI de aviso quando fora do fluxo habitual. Fail-closed: sem edição
 * válida → escrita bloqueada.
 * ------------------------------------------------------------------------- */

const CREDENTIAL_TYPES: DigitalCredentialType[] = ['certificate', 'digital_seal'];

function CredentialManager({
  distinction,
  businessName,
  credentials,
  fulfillmentItems,
  campaignYear,
  campaignName,
  cityName,
  categoryName,
  modalityName,
  distinctionLabel,
  programName,
  programPrefix,
  hasCampaign,
  onChanged,
  onClose,
}: {
  distinction: AwardDistinction;
  businessName: string;
  credentials: DigitalCredential[];
  fulfillmentItems: DistinctionFulfillment[];
  campaignYear: number | null;
  campaignName: string | null;
  cityName: string;
  categoryName: string;
  modalityName: string | null;
  distinctionLabel: string;
  programName: string;
  programPrefix: string;
  hasCampaign: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<DigitalCredentialType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DigitalCredential | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [preview, setPreview] = useState<{ credential: DigitalCredential; kind: CredentialPreviewKind } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  function displayDataFor(credential: DigitalCredential): CredentialDisplayData {
    return resolveCredentialDisplayData({
      credential: {
        credential_type: credential.credential_type,
        verification_code: credential.verification_code,
        issued_at: credential.issued_at,
        status: credential.status,
      },
      distinctionLabel,
      businessName,
      parentBrandName: 'The Best Europa',
      programName,
      campaignYear,
      campaignName,
      cityName,
      categoryName,
      modalityName,
      programPrefix,
    });
  }

  async function handleDownloadVisual(credential: DigitalCredential) {
    if (credential.status !== 'issued') {
      setError('Credencial revogada — geração e download bloqueados. O preview apresenta o carimbo REVOGADO.');
      return;
    }
    setError(null);
    setDownloading(credential.id);
    try {
      const data = displayDataFor(credential);
      if (credential.credential_type === 'certificate') {
        await downloadCertificatePdf(data, certificateFilename(businessName, campaignYear));
      } else {
        await downloadSealPng(data, sealFilename(businessName, campaignYear));
      }
      setInfo('Ficheiro gerado localmente a partir da credencial emitida. Mérito, relação comercial, reconhecimento, votos e ranking inalterados.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar o ficheiro.');
    } finally {
      setDownloading(null);
    }
  }

  const fulfillmentByType = useMemo(() => {
    const m = new Map<FulfillmentItemType, DistinctionFulfillment>();
    for (const it of fulfillmentItems) m.set(it.item_type, it);
    return m;
  }, [fulfillmentItems]);

  const eligibilityHint = fulfillmentEligibilityHint(distinction);

  async function handleIssue(t: DigitalCredentialType) {
    setError(null);
    setInfo(null);
    if (!hasCampaign) {
      setError('Sem edição válida — emissão bloqueada (fail-closed).');
      return;
    }
    setBusy(t);
    try {
      const fulfillment = fulfillmentByType.get(t as FulfillmentItemType) ?? null;
      const { duplicate } = await issueCredential(
        {
          award_distinction_id: distinction.id,
          credential_type: t,
          fulfillment_id: fulfillment?.id ?? null,
          countryCode: 'PT',
          year: campaignYear ?? new Date().getFullYear(),
        },
        distinction,
      );
      if (duplicate) {
        setInfo(
          `Já existe ${DIGITAL_CREDENTIAL_TYPE_LABELS[t]} emitido para esta distinção. Revogue o atual antes de gerar um novo.`,
        );
      } else {
        setInfo(`${DIGITAL_CREDENTIAL_TYPE_LABELS[t]} emitido. Mérito, relação comercial, reconhecimento, votos e ranking inalterados.`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar a credencial.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRevokeConfirm() {
    if (!revokeTarget) return;
    const motive = revokeReason.trim();
    if (motive === '') {
      setError('Motivo da revogação obrigatório.');
      return;
    }
    setError(null);
    setRevoking(true);
    try {
      await revokeCredential(revokeTarget, motive, {
        award_distinction_id: distinction.id,
        credential_type: revokeTarget.credential_type,
        verification_code: revokeTarget.verification_code,
      });
      setInfo('Credencial revogada. O registo foi preservado para histórico.');
      setRevokeTarget(null);
      setRevokeReason('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao revogar a credencial.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Modal title={`Credenciais verificáveis — ${businessName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <FormError message={error} />
        {info && (
          <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
            {info}
          </p>
        )}
        {eligibilityHint && (
          <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200">
            {eligibilityHint} A emissão é apenas reconhecimento verificável e nunca altera os outros estados.
          </p>
        )}
        <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs leading-relaxed text-slate-400">
          Cada ativo emitido possui código único não previsível (formato{' '}
          <span className="font-mono text-gold-300">TBE-PT-AAAA-…</span>). A emissão reconhece a
          distinção existente — não cria mérito, não altera votos, ranking, mérito, relação comercial
          nem o reconhecimento configurado.
        </p>
        <div className="space-y-3">
          {CREDENTIAL_TYPES.map((t) => {
            const active = activeCredential(credentials, t);
            const history = credentialHistory(credentials, t);
            const revoked = history.filter((c) => c.status === 'revoked');
            const fulfillment = fulfillmentByType.get(t as FulfillmentItemType) ?? null;
            return (
              <fieldset key={t} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">{DIGITAL_CREDENTIAL_TYPE_LABELS[t]}</span>
                  {!active && revoked.length === 0 && (
                    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-slate-300">
                      Não emitido
                    </span>
                  )}
                  {active && (
                    <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200">
                      {DIGITAL_CREDENTIAL_STATUS_LABELS.issued}
                    </span>
                  )}
                  {!active && revoked.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-200">
                        {DIGITAL_CREDENTIAL_STATUS_LABELS.revoked}
                      </span>
                      <span className="inline-flex items-center rounded-md border border-red-500/50 bg-red-500/20 px-2 py-0.5 text-[11px] font-bold tracking-wider text-red-100">
                        REVOGADO
                      </span>
                    </span>
                  )}
                  {!fulfillment && (
                    <span className="text-[11px] text-slate-500">(sem item de reconhecimento configurado — a emissão continua possível e não o altera)</span>
                  )}
                </div>
                {active && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs leading-relaxed">
                    <p>
                      <span className="text-slate-500">Código: </span>
                      <span className="font-mono font-bold text-gold-300">{active.verification_code}</span>
                    </p>
                    <p className="mt-1 text-slate-400">
                      Data de emissão: {new Date(active.issued_at).toLocaleString('pt-PT')}
                    </p>
                  </div>
                )}
                {revoked.length > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Histórico preservado: {revoked.length} {revoked.length === 1 ? 'revogada' : 'revogadas'} (registos mantidos, nunca apagados).
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {!active && (
                    <button
                      type="button"
                      onClick={() => handleIssue(t)}
                      disabled={!hasCampaign || busy !== null}
                      title={`Gerar credencial (${DIGITAL_CREDENTIAL_TYPE_LABELS[t]})`}
                      className="inline-flex items-center gap-1 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs font-semibold text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
                    >
                      {busy === t ? 'A gerar…' : 'Gerar credencial'}
                    </button>
                  )}
                  {active && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPreview({
                          credential: active,
                          kind: t === 'certificate' ? 'certificate' : 'seal',
                        })}
                        title={t === 'certificate' ? 'Pré-visualizar certificado' : 'Pré-visualizar selo'}
                        className="inline-flex items-center gap-1 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs font-semibold text-gold-300 transition hover:bg-gold-500/20"
                      >
                        {t === 'certificate' ? 'Pré-visualizar certificado' : 'Pré-visualizar selo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadVisual(active)}
                        disabled={downloading === active.id}
                        title={t === 'certificate' ? 'Descarregar certificado' : 'Descarregar selo'}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-200 transition hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                      >
                        {downloading === active.id ? 'A gerar…' : t === 'certificate' ? 'Descarregar certificado' : 'Descarregar selo'}
                      </button>
                      <a
                        href={`#/${programPrefix}/verificar/${active.verification_code}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Verificar autenticidade (abre a rota pública)"
                        className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 text-xs font-semibold text-teal-200 transition hover:bg-teal-500/20"
                      >
                        Verificar autenticidade
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setRevokeTarget(active);
                          setRevokeReason('');
                          setError(null);
                        }}
                        disabled={!hasCampaign}
                        title={`Revogar ${DIGITAL_CREDENTIAL_TYPE_LABELS[t]}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40"
                      >
                        Revogar
                      </button>
                    </>
                  )}
                  {!active && revoked.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPreview({
                        credential: revoked[revoked.length - 1],
                        kind: t === 'certificate' ? 'certificate' : 'seal',
                      })}
                      title="Pré-visualizar (REVOGADO — carimbo aplicado, download bloqueado)"
                      className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"
                    >
                      Pré-visualizar (REVOGADO)
                    </button>
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>
        {revokeTarget && (
          <div role="dialog" aria-label="Confirmar revogação" className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4">
            <p className="text-sm font-semibold text-red-200">
              Confirmar revogação — {DIGITAL_CREDENTIAL_TYPE_LABELS[revokeTarget.credential_type]}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-300">{revokeTarget.verification_code}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              A revogação preserva o registo para histórico (nunca apaga). O motivo é administrativo e
              nunca será exposto na verificação pública.
            </p>
            <label htmlFor="revoke-reason" className="mt-3 block text-xs font-semibold text-slate-300">
              Motivo da revogação (obrigatório)
            </label>
            <textarea
              id="revoke-reason"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              rows={3}
              placeholder="Ex.: código emitido para distinção incorreta"
              className="mt-1 w-full rounded-xl border border-white/15 bg-navy-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-red-500/60 focus:outline-none"
            />
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setRevokeTarget(null);
                  setRevokeReason('');
                }}
                disabled={revoking}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRevokeConfirm}
                disabled={revoking || revokeReason.trim() === ''}
                className="rounded-xl border border-red-500/50 bg-red-500/20 px-6 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-500/30 disabled:opacity-50"
              >
                {revoking ? 'A revogar…' : 'Confirmar revogação'}
              </button>
            </div>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-slate-500">
          URL verificável (QR): <span className="font-mono">/{programPrefix}/verificar/CÓDIGO</span> —{' '}
          {verificationUrl(programPrefix, 'TBE-PT-2026-EXEMPLO')}. O QR contém somente esta URL pública.
        </p>
        {preview && (
          <Modal
            title={`${preview.kind === 'certificate' ? 'Pré-visualizar certificado' : 'Pré-visualizar selo'} — ${businessName}`}
            onClose={() => setPreview(null)}
            wide
          >
            <CredentialPreview
              kind={preview.kind}
              data={displayDataFor(preview.credential)}
              onVerify={() => {
                window.open(`#/${programPrefix}/verificar/${preview.credential.verification_code}`, '_blank', 'noopener');
              }}
            />
          </Modal>
        )}
      </div>
    </Modal>
  );
}

function packagePillClass(status: string): string {
  if (status === 'active') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'pending') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (status === 'cancelled') return 'border-red-500/30 bg-red-500/10 text-red-200';
  return 'border-white/15 bg-white/5 text-slate-300';
}

/* ---------------------------------------------------------------------------
 * FASE 6.3.1 — Modal de registo da adesão ao Pacote Oficial Digital.
 * Registo ADMINISTRATIVO (sem pagamento): escreve SOMENTE em
 * distinction_package_adoptions via createPackageAdoption (auditada).
 * NUNCA altera award_status, commercial_status, votos, ranking, vencedor,
 * fulfillment ou credenciais. Consentimento Meta Ads OBRIGATÓRIO
 * (meta_ads_consent_at = now() ao marcar). Fail-closed: sem edição válida
 * → registo bloqueado.
 * ------------------------------------------------------------------------- */

function PackageAdoptionModal({
  distinction,
  businessName,
  cityName,
  categoryName,
  modalityName,
  hasCampaign,
  onChanged,
  onClose,
}: {
  distinction: AwardDistinction;
  businessName: string;
  cityName: string;
  categoryName: string;
  modalityName: string | null;
  hasCampaign: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [consented, setConsented] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hasCampaign) {
      setError('Sem edição válida — registo bloqueado (fail-closed).');
      return;
    }
    if (!consented) {
      setError('O consentimento da campanha patrocinada conjunta é obrigatório.');
      return;
    }
    setSaving(true);
    try {
      const result = await createPackageAdoption(
        {
          award_distinction_id: distinction.id,
          metaAdsConsented: true,
          notes: notes.trim() === '' ? null : notes.trim(),
        },
        distinction,
      );
      if (result.duplicate) {
        setError('Esta distinção já possui uma adesão registada.');
        return;
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registar a adesão.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Registar adesão ao Pacote Oficial Digital" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={error} />
        <dl className="grid grid-cols-2 gap-2 text-[13px]">
          <dt className="text-slate-500">Empresa</dt>
          <dd className="font-semibold text-white">{businessName}</dd>
          <dt className="text-slate-500">Cidade</dt>
          <dd className="text-slate-200">{cityName}</dd>
          <dt className="text-slate-500">Categoria</dt>
          <dd className="text-slate-200">{categoryName}</dd>
          <dt className="text-slate-500">Distinção</dt>
          <dd className="text-slate-200">{modalityName ?? '—'}</dd>
        </dl>
        <div className="rounded-2xl border border-gold-500/20 bg-gold-500/[0.05] p-4 text-[13px] leading-relaxed">
          <p className="text-slate-500">Pacote</p>
          <p className="font-semibold text-white">{PILOT_DIGITAL_PACKAGE.package_name}</p>
          <p className="mt-1 text-slate-300">
            Valor: <strong className="text-white">{formatPriceCents(PILOT_DIGITAL_PACKAGE.price_cents, PILOT_DIGITAL_PACKAGE.currency)}</strong>
            {' '}· Formato: <strong className="text-white">100% digital</strong>
          </p>
          <ul className="mt-2 space-y-1 text-slate-200">
            <li>✓ Certificado Digital Oficial</li>
            <li>✓ Verificação pública por QR Code</li>
            <li>✓ Selo Digital Oficial 2026</li>
            <li>✓ Kit Digital do Vencedor</li>
            <li>✓ Divulgação The Best Europa</li>
            <li>✓ Participação na campanha patrocinada conjunta de 15 dias</li>
          </ul>
        </div>
        <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200">
          AVISO META ADS: {META_ADS_COLLECTIVE_NOTICE}
        </p>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs leading-relaxed text-slate-200">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-yellow-500"
          />
          <span>A empresa foi informada e aceitou a participação na campanha patrocinada conjunta.</span>
        </label>
        <Field label="Notas internas (opcional)">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Notas administrativas da adesão… (nunca públicas)"
          />
        </Field>
        <p role="note" className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-sky-200">
          {PACKAGE_NON_INTERFERENCE_NOTICE}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !consented || !hasCampaign}
            title="Registar adesão — 49,90 €"
            className="rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'A registar…' : `Registar adesão — ${formatPriceCents(PILOT_DIGITAL_PACKAGE.price_cents, PILOT_DIGITAL_PACKAGE.currency)}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function DistinctionsAdminPage() {
  const {
    selectedProgram,
    selectedProgramId,
    selectedCampaign,
    selectedCampaignId,
  } = useAdminProgram();
  const [searchParams] = useSearchParams();

  const countryCode = selectedProgram?.country_code ?? null;
  const citiesQuery = useScopedCities(countryCode);
  const categoriesQuery = useScopedCategories(selectedProgramId);
  const modalitiesQuery = useScopedModalities(selectedProgramId);
  const businessesQuery = useScopedBusinesses(countryCode);
  const distinctionsQuery = useScopedDistinctions(
    selectedCampaignId,
    selectedProgramId,
  );

  const [cityFilter, setCityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [modalityFilter, setModalityFilter] = useState('all');
  const [awardFilter, setAwardFilter] = useState('all');
  const [commercialFilter, setCommercialFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Deep-link a partir de Resultados ("Gerir distinção") ou Modalidades
  // ("Ver distinções"): ?city=&category=&modality=&business=
  useEffect(() => {
    const city = searchParams.get('city');
    const category = searchParams.get('category');
    const modality = searchParams.get('modality');
    if (city) setCityFilter(city);
    if (category) setCategoryFilter(category);
    if (modality) setModalityFilter(modality);
    const business = searchParams.get('business');
    if (business) setSearch(business);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tallyMap, setTallyMap] = useState<Record<string, TallyEntry>>({});
  const [tallyError, setTallyError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmInfo, setConfirmInfo] = useState<string | null>(null);

  const [notesTarget, setNotesTarget] = useState<AwardDistinction | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  // FASE 5C.3.12 — reconhecimento/entrega (quarta dimensão, independente).
  const [fulfillmentTarget, setFulfillmentTarget] = useState<AwardDistinction | null>(null);

  // FASE 5C.3.13 — credenciais verificáveis (certificado/selo).
  const [credentialTarget, setCredentialTarget] = useState<AwardDistinction | null>(null);

  // FASE 6.3.1 — adesão ao Pacote Oficial Digital (camada comercial separada).
  const [packageTarget, setPackageTarget] = useState<AwardDistinction | null>(null);
  const [packageBusyId, setPackageBusyId] = useState<string | null>(null);

  const [rowError, setRowError] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId);
  const hasCampaign = Boolean(selectedCampaign && selectedCampaignId);

  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const modalities = useMemo(
    () => modalitiesQuery.data ?? [],
    [modalitiesQuery.data],
  );
  const businesses = useMemo(
    () => businessesQuery.data ?? [],
    [businessesQuery.data],
  );
  const distinctions = useMemo(
    () => distinctionsQuery.data ?? [],
    [distinctionsQuery.data],
  );

  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const modalityById = useMemo(
    () => new Map(modalities.map((m) => [m.id, m])),
    [modalities],
  );
  const businessById = useMemo(
    () => new Map(businesses.map((b) => [b.id, b])),
    [businesses],
  );

  // Modalidades disponíveis no filtro respeitam categoria selecionada.
  const modalityOptions = useMemo(
    () =>
      categoryFilter === 'all'
        ? modalities
        : modalities.filter((m) => m.category_id === categoryFilter),
    [modalities, categoryFilter],
  );

  const filtered = useMemo(() => {
    let rows = distinctions;
    if (cityFilter !== 'all') rows = rows.filter((d) => d.city_id === cityFilter);
    if (categoryFilter !== 'all') {
      rows = rows.filter((d) => d.category_id === categoryFilter);
    }
    if (modalityFilter !== 'all') {
      rows = rows.filter((d) => d.modality_id === modalityFilter);
    }
    if (awardFilter !== 'all') rows = rows.filter((d) => d.award_status === awardFilter);
    if (commercialFilter !== 'all') {
      rows = rows.filter((d) => d.commercial_status === commercialFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) => {
        const name =
          businessById.get(d.business_id)?.name ?? d.business_id;
        return name.toLowerCase().includes(q);
      });
    }
    return rows;
  }, [
    distinctions,
    cityFilter,
    categoryFilter,
    modalityFilter,
    awardFilter,
    commercialFilter,
    search,
    businessById,
  ]);

  // Posição/votos SEMPRE de get_admin_modality_tally (nunca de
  // award_distinctions). Agrupa por combinação (cidade × categoria ×
  // modalidade) e consulta a RPC uma vez por combinação (cap fail-safe).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTallyError(null);
      if (!supabase || !selectedCampaignId || filtered.length === 0) {
        if (!cancelled) setTallyMap({});
        return;
      }
      const combos = new Map<string, { city: string; category: string; modality: string }>();
      for (const d of filtered) {
        const k = comboKey(d.city_id, d.category_id, d.modality_id);
        if (!combos.has(k)) {
          combos.set(k, {
            city: d.city_id,
            category: d.category_id,
            modality: d.modality_id,
          });
        }
        if (combos.size >= 25) break;
      }
      const client = supabase;
      if (!client) {
        if (!cancelled) setTallyMap({});
        return;
      }
      try {
        const entries = await Promise.all(
          [...combos.entries()].map(async ([ck, c]) => {
            const { data, error } = await client.rpc(
              'get_admin_modality_tally',
              {
                p_campaign_id: selectedCampaignId,
                p_city_id: c.city,
                p_category_id: c.category,
                p_modality_id: c.modality,
              },
            );
            if (error) throw error;
            return {
              ck,
              city: c.city,
              category: c.category,
              modality: c.modality,
              rows: (data ?? []) as {
                business_id: string;
                total_votes: number | string;
                position: number | string;
              }[],
            };
          }),
        );
        if (cancelled) return;
        const map: Record<string, TallyEntry> = {};
        for (const g of entries) {
          for (const r of g.rows) {
            map[
              tallyKey(g.city, g.category, g.modality, String(r.business_id))
            ] = {
              position: Number(r.position ?? 0),
              total_votes: Number(r.total_votes ?? 0),
            };
          }
        }
        setTallyMap(map);
      } catch (e) {
        if (!cancelled) {
          setTallyMap({});
          setTallyError(
            e instanceof Error ? e.message : 'Falha ao ler o apuramento das modalidades.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtered, selectedCampaignId]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const pending = filtered.filter((d) => d.commercial_status === 'pending').length;
    const contacted = filtered.filter((d) => d.commercial_status === 'contacted').length;
    const accepted = filtered.filter((d) => d.commercial_status === 'accepted').length;
    const declined = filtered.filter((d) => d.commercial_status === 'declined').length;
    const confirmed = filtered.filter((d) => d.commercial_status === 'confirmed').length;
    return { total, pending, contacted, accepted, declined, confirmed };
  }, [filtered]);

  // FASE 5C.3.12 — mapa distinção → itens de reconhecimento.
  // Isolado por campanha/programa porque os IDs vêm de `distinctions`
  // (já filtradas por selectedCampaignId + programa). Fail-closed: sem
  // distinções → {} (hook retorna vazio, nunca global).
  const distinctionIds = useMemo(() => distinctions.map((d) => d.id), [distinctions]);
  const fulfillmentQuery = useScopedFulfillment(distinctionIds);
  const fulfillmentByDistinction = useMemo(
    () => fulfillmentQuery.data ?? {},
    [fulfillmentQuery.data],
  );
  // Resumo OPERACIONAL (nunca votos/ranking): agregado sobre os itens.
  const fulfillmentSummary = useMemo(() => {
    const all: DistinctionFulfillment[] = Object.values(fulfillmentByDistinction).flat();
    return summarizeFulfillment(all);
  }, [fulfillmentByDistinction]);

  // FASE 5C.3.13 — mapa distinção → credenciais verificáveis.
  // Isolado por campanha/programa porque os IDs vêm de `distinctions`
  // (já filtradas por selectedCampaignId + programa). Fail-closed: sem
  // distinções → {} (hook retorna vazio, nunca global).
  const credentialsQuery = useScopedCredentials(distinctionIds);
  const credentialsByDistinction = useMemo(
    () => credentialsQuery.data ?? {},
    [credentialsQuery.data],
  );

  // FASE 6.3.1 — mapa distinção → adesão ao Pacote Oficial Digital.
  // Isolado por campanha/programa porque os IDs vêm de `distinctions`
  // (já filtradas por selectedCampaignId + programa). Fail-closed: sem
  // distinções → {} (hook retorna vazio, nunca global). A adesão NUNCA
  // altera mérito, comercial, votos, ranking, vencedor ou resultados.
  const packageQuery = useScopedPackageAdoptions(distinctionIds);
  const packageByDistinction = useMemo(
    () => packageQuery.data ?? {},
    [packageQuery.data],
  );

  const loading =
    citiesQuery.loading ||
    categoriesQuery.loading ||
    modalitiesQuery.loading ||
    businessesQuery.loading ||
    distinctionsQuery.loading;

  async function handleCreateFromTally() {
    setConfirmError(null);
    setConfirmInfo(null);
    if (!confirm || !selectedCampaignId) return;
    if (!hasProgram || !hasCampaign) {
      setConfirmError(
        'Sem edição válida — selecione um programa e uma edição antes de criar distinções.',
      );
      return;
    }
    setCreating(true);
    try {
      const result = await createDistinction({
        campaign_id: selectedCampaignId,
        city_id: confirm.city_id,
        category_id: confirm.category_id,
        modality_id: confirm.modality_id,
        business_id: confirm.business_id,
        position: confirm.position,
        source: 'modality_vote',
      });
      if (result.duplicate) {
        setConfirmInfo(
          'Esta empresa já possui uma distinção nesta modalidade.',
        );
      } else {
        setConfirm(null);
        distinctionsQuery.refetch();
      }
    } catch (e) {
      setConfirmError(
        e instanceof Error ? e.message : 'Falha ao criar a distinção.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleAwardChange(d: AwardDistinction, next: AwardStatus) {
    setRowError(null);
    if (!hasCampaign || !selectedCampaignId) {
      setRowError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    try {
      await updateAwardStatus(d, next, {
        campaign_id: selectedCampaignId,
        city_id: d.city_id,
        category_id: d.category_id,
        modality_id: d.modality_id,
        business_id: d.business_id,
        previous: d.award_status,
      });
      distinctionsQuery.refetch();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Falha ao alterar o mérito.');
    }
  }

  async function handleCommercialChange(d: AwardDistinction, next: CommercialStatus) {
    setRowError(null);
    if (!hasCampaign || !selectedCampaignId) {
      setRowError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    if (d.commercial_status === next) return;
    setBusyRowId(d.id);
    try {
      // REGRA ABSOLUTA: declined guarda-se e nada mais acontece.
      // Esta função altera SOMENTE commercial_status (ver lib/distinctions).
      // NUNCA altera award_status, NUNCA cria nova distinção, NUNCA transfere
      // posição, NUNCA toca em votos/rankings.
      await updateCommercialStatus(d, next, {
        campaign_id: selectedCampaignId,
        city_id: d.city_id,
        category_id: d.category_id,
        modality_id: d.modality_id,
        business_id: d.business_id,
        previous: d.commercial_status,
      });
      distinctionsQuery.refetch();
    } catch (e) {
      setRowError(
        e instanceof Error ? e.message : 'Falha ao alterar o estado comercial.',
      );
    } finally {
      setBusyRowId(null);
    }
  }

  async function handleCancelPackage(d: AwardDistinction, adoption: DistinctionPackageAdoption) {
    setRowError(null);
    if (!hasCampaign) {
      setRowError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    setPackageBusyId(d.id);
    try {
      // O cancelamento comercial preserva mérito, votos, ranking e vitória.
      await cancelPackageAdoption(adoption, null);
      packageQuery.refetch();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Falha ao cancelar a adesão.');
    } finally {
      setPackageBusyId(null);
    }
  }

  async function handleReactivatePackage(d: AwardDistinction, adoption: DistinctionPackageAdoption) {
    setRowError(null);
    if (!hasCampaign) {
      setRowError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    setPackageBusyId(d.id);
    try {
      await reactivatePackageAdoption(adoption);
      packageQuery.refetch();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Falha ao reativar a adesão.');
    } finally {
      setPackageBusyId(null);
    }
  }

  function openNotes(d: AwardDistinction) {
    setNotesTarget(d);
    setNotesDraft(d.notes ?? '');
    setNotesError(null);
  }

  async function handleSaveNotes(e: React.FormEvent) {
    e.preventDefault();
    if (!notesTarget) return;
    if (!hasCampaign) {
      setNotesError('Sem edição válida — alteração bloqueada (fail-closed).');
      return;
    }
    setSavingNotes(true);
    setNotesError(null);
    try {
      await updateDistinctionNotes(notesTarget, notesDraft);
      setNotesTarget(null);
      distinctionsQuery.refetch();
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : 'Falha ao guardar as notas.');
    } finally {
      setSavingNotes(false);
    }
  }

  if (loading) return <PageLoading label="A carregar distinções…" />;

  const cards: { label: string; value: number; hint: string }[] = [
    { label: 'Total de distinções', value: summary.total, hint: 'edição atual' },
    { label: 'Pendentes de contacto', value: summary.pending, hint: 'commercial = pendente' },
    { label: 'Contactadas', value: summary.contacted, hint: 'commercial = contactado' },
    { label: 'Aceites', value: summary.accepted, hint: 'commercial = aceite' },
    { label: 'Recusadas', value: summary.declined, hint: 'sem efeito no mérito' },
    { label: 'Confirmadas', value: summary.confirmed, hint: 'commercial = confirmado' },
  ];

  return (
    <div>
      <AdminHeader
        title="Distinções"
        description={`Gestão operacional das distinções do programa${selectedProgram ? ` · ${selectedProgram.name}` : ' (sem programa válido)'} — mérito e relação comercial em separado, sem alterar o resultado oficial.`}
      />
      <SupabaseNotice />
      <AdminScopeBanner requireCampaign />

      {/* FASE 5C.3.11 — pipeline operacional: mérito × comercial sempre separados.
          commercial_status NUNCA altera award_status automaticamente. */}
      <div className="mb-4 rounded-2xl border border-gold-500/20 bg-gold-500/[0.05] p-4 text-[13px] leading-relaxed text-slate-300">
        <p className="font-semibold text-white">Fluxo operacional — mérito ≠ comercial</p>
        <p className="mt-1">
          Pipeline comercial: <strong className="text-white">Pendente → Contactado → Aceite → Confirmado</strong>
          {' '}· alternativas: <strong className="text-white">Pendente/Contactado → Recusado</strong>
          {' '}· <strong className="text-white">qualquer estado → Cancelado</strong>.
          A recusa (<strong className="text-red-200">Recusou a distinção</strong>) preserva empresa, modalidade,
          posição, mérito, votos e histórico — sem transferir prémios nem criar vencedores.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Mérito (award_status): Elegível · Selecionado · Vencedor · Confirmado · Cancelado — alterado apenas pelo
          controlo de mérito. Comercial (commercial_status): Pendente · Contactado · Aceite · Recusado · Confirmado ·
          Cancelado — CRM simples, sem módulo financeiro.
        </p>
      </div>

      {!hasProgram ? (
        <ErrorState
          message="Sem programa válido selecionado — selecione um programa no seletor global. Nenhuma distinção é apresentada por fallback."
          onRetry={distinctionsQuery.refetch}
        />
      ) : !hasCampaign ? (
        <ErrorState
          message="Sem edição válida selecionada — selecione uma edição do programa. A criação e alteração de distinções estão bloqueadas."
          onRetry={distinctionsQuery.refetch}
        />
      ) : distinctionsQuery.error && filtered.length === 0 ? (
        <ErrorState message={distinctionsQuery.error} onRetry={distinctionsQuery.refetch} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {cards.map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {c.label}
                </p>
                <p className="mt-1 text-2xl font-bold text-white">{c.value}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{c.hint}</p>
              </div>
            ))}
          </div>

          {/* FASE 5C.3.12 — resumo OPERACIONAL do reconhecimento (nunca
              votos/ranking). Números sobre distinction_fulfillment. */}
          <div className="mt-3 rounded-2xl border border-teal-500/20 bg-teal-500/[0.04] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Reconhecimento — resumo operacional
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: 'Reconhecimentos pendentes', value: fulfillmentSummary.pending, hint: 'fulfillment = pendente' },
                { label: 'Em preparação', value: fulfillmentSummary.preparing, hint: 'fulfillment = em preparação' },
                { label: 'Prontos', value: fulfillmentSummary.ready, hint: 'fulfillment = pronto' },
                { label: 'Entregues', value: fulfillmentSummary.delivered, hint: 'fulfillment = entregue' },
                { label: 'Total de itens', value: fulfillmentSummary.total, hint: 'itens configurados' },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-white/10 bg-navy-950/50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{c.label}</p>
                  <p className="mt-1 text-xl font-bold text-white">{c.value}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{c.hint}</p>
                </div>
              ))}
            </div>
            {fulfillmentQuery.error && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                Reconhecimento indisponível: {fulfillmentQuery.error}
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Números operacionais sobre o reconhecimento/entrega — nunca misturados com votos ou ranking.
            </p>
          </div>

          <AdminCard title={`Filtros — ${selectedProgram?.name}`} className="mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cidade (somente do país do programa)">
                <Select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todas as cidades</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Categoria (somente do programa)">
                <Select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setModalityFilter('all');
                  }}
                >
                  <option value="all" className="bg-navy-900">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className="bg-navy-900">{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Modalidade (somente do programa)">
                <Select value={modalityFilter} onChange={(e) => setModalityFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todas as modalidades</option>
                  {modalityOptions.map((m) => (
                    <option key={m.id} value={m.id} className="bg-navy-900">{m.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Estado da distinção (mérito)">
                <Select value={awardFilter} onChange={(e) => setAwardFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todos</option>
                  {AWARD_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-navy-900">{AWARD_STATUS_LABELS[s]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Estado comercial">
                <Select value={commercialFilter} onChange={(e) => setCommercialFilter(e.target.value)}>
                  <option value="all" className="bg-navy-900">Todos</option>
                  {COMMERCIAL_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-navy-900">{COMMERCIAL_STATUS_LABELS[s]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Pesquisa por empresa">
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nome da empresa…"
                />
              </Field>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Edição em análise: {selectedCampaign?.year} — {selectedCampaign?.name}.
              Posição e votos apresentados abaixo vêm de{' '}
              <code className="font-mono text-gold-200">get_admin_modality_tally</code>{' '}
              (modality_votes) — nunca copiados para award_distinctions.
            </p>
            {tallyError && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                Apuramento das modalidades indisponível: {tallyError}
              </p>
            )}
            {rowError && (
              <p role="alert" className="mt-2 text-xs text-red-300">{rowError}</p>
            )}
          </AdminCard>

          <div className="mt-4">
            <AdminCard title={`Distinções — ${selectedProgram?.name} (${filtered.length})`}>
              <AdminTable<AwardDistinction & Record<string, unknown>>
                rows={filtered.map((d) => ({ ...d }))}
                searchable={false}
                emptyMessage="Sem distinções para os filtros selecionados. Crie distinções a partir de Admin → Resultados → Resultados das modalidades (ação “Criar distinção”)."
                columns={[
                  {
                    key: 'business_id',
                    label: 'Empresa',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <span className="font-medium text-white">
                          {businessById.get(d.business_id)?.name ?? d.business_id.slice(0, 8)}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'city_id',
                    label: 'Cidade',
                    render: (r) => (
                      <span className="text-xs text-slate-300">
                        {cityById.get(String((r as unknown as AwardDistinction).city_id))?.name ?? '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'category_id',
                    label: 'Categoria',
                    render: (r) => (
                      <span className="text-xs text-slate-300">
                        {categoryById.get(String((r as unknown as AwardDistinction).category_id))?.name ?? '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'modality_id',
                    label: 'Modalidade',
                    render: (r) => (
                      <span className="text-xs text-slate-300">
                        {modalityById.get(String((r as unknown as AwardDistinction).modality_id))?.name ?? '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'position',
                    label: 'Posição (modalidade)',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const t = tallyMap[tallyKey(d.city_id, d.category_id, d.modality_id, d.business_id)];
                      return (
                        <span className="text-xs text-slate-200" title="Via get_admin_modality_tally">
                          {t ? `${t.position}.º` : '—'}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'votes',
                    label: 'Votos (modalidade)',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const t = tallyMap[tallyKey(d.city_id, d.category_id, d.modality_id, d.business_id)];
                      return (
                        <strong className="text-xs text-gold-300" title="Via get_admin_modality_tally">
                          {t ? t.total_votes : '—'}
                        </strong>
                      );
                    },
                  },
                  {
                    key: 'award_status',
                    label: 'Distinção (mérito)',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <span className="flex flex-col gap-1.5">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pillClass('award', d.award_status)}`}>
                            <Award className="h-3 w-3" />
                            {AWARD_STATUS_LABELS[d.award_status] ?? d.award_status}
                          </span>
                          <select
                            aria-label="Alterar estado da distinção"
                            value={d.award_status}
                            disabled={!isSupabaseConfigured || !hasCampaign}
                            onChange={(e) => handleAwardChange(d, e.target.value as AwardStatus)}
                            className="w-32 rounded-lg border border-white/15 bg-navy-950 px-2 py-1 text-[11px] text-slate-200"
                          >
                            {AWARD_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-navy-900">{AWARD_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'commercial_status',
                    label: 'Estado comercial',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const busy = busyRowId === d.id;
                      const suggested = nextCommercialTransitions(d.commercial_status);
                      const quickLabel = (s: CommercialStatus): string =>
                        COMMERCIAL_QUICK_ACTIONS.find((a) => a.next === s)?.label ?? s;
                      return (
                        <span className="flex min-w-44 flex-col gap-1.5">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pillClass('commercial', d.commercial_status)}`}>
                            <PhoneCall className="h-3 w-3" />
                            {COMMERCIAL_STATUS_LABELS[d.commercial_status] ?? d.commercial_status}
                          </span>
                          {d.commercial_status === 'declined' && (
                            <span role="status" className="inline-flex w-fit items-center rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-200">
                              Recusou a distinção — mérito preservado, sem transferência
                            </span>
                          )}
                          <select
                            aria-label="Alterar estado comercial"
                            value={d.commercial_status}
                            disabled={!isSupabaseConfigured || !hasCampaign || busy}
                            onChange={(e) => handleCommercialChange(d, e.target.value as CommercialStatus)}
                            className="w-36 rounded-lg border border-white/15 bg-navy-950 px-2 py-1 text-[11px] text-slate-200"
                          >
                            {COMMERCIAL_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-navy-900">{COMMERCIAL_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                          <span className="flex max-w-52 flex-wrap gap-1" aria-label="Ações rápidas comerciais">
                            {suggested.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => handleCommercialChange(d, s)}
                                disabled={!isSupabaseConfigured || !hasCampaign || busy || d.commercial_status === s}
                                title={quickLabel(s)}
                                className="rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                              >
                                {busy ? '…' : quickLabel(s).replace('Marcar como ', '').replace('Confirmar', 'Confirmar').replace('Cancelar', 'Cancelar')}
                              </button>
                            ))}
                          </span>
                          <span className="sr-only">
                            {COMMERCIAL_QUICK_ACTIONS.map((a) => a.label).join(' · ')}
                          </span>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'source',
                    label: 'Origem',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pillClass('source', d.source)}`}>
                          {SOURCE_LABELS[d.source] ?? d.source}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'fulfillment',
                    label: 'Reconhecimento',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const items = fulfillmentByDistinction[d.id] ?? [];
                      return (
                        <span className="flex min-w-44 flex-col gap-1.5">
                          <span className="text-[11px] leading-relaxed text-slate-300" title="Resumo operacional do reconhecimento">
                            {fulfillmentCompactLabel(items)}
                          </span>
                          {items.length > 0 && (
                            <span className="flex max-w-52 flex-wrap gap-1">
                              {items.map((it) => (
                                <span
                                  key={it.id}
                                  title={`${FULFILLMENT_ITEM_LABELS[it.item_type]} — ${FULFILLMENT_STATUS_LABELS[it.status]}`}
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pillClass('fulfillment', it.status)}`}
                                >
                                  {FULFILLMENT_ITEM_LABELS[it.item_type]} · {FULFILLMENT_STATUS_LABELS[it.status]}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setFulfillmentTarget(d)}
                              disabled={!hasCampaign}
                              title={items.length > 0 ? 'Ver reconhecimento' : 'Configurar reconhecimento'}
                              className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 text-xs font-semibold text-teal-200 transition hover:bg-teal-500/20 disabled:opacity-40"
                            >
                              <PackageCheck className="h-3 w-3" />
                              {items.length > 0 ? 'Ver reconhecimento' : 'Configurar'}
                            </button>
                            {items.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setFulfillmentTarget(d)}
                                disabled={!hasCampaign}
                                title="Gerir reconhecimento"
                                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                              >
                                Gerir reconhecimento
                              </button>
                            )}
                          </span>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'credentials',
                    label: 'Credenciais',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const creds = credentialsByDistinction[d.id] ?? [];
                      const cert = activeCredential(creds, 'certificate');
                      const seal = activeCredential(creds, 'digital_seal');
                      const revokedCount = creds.filter((c) => c.status === 'revoked').length;
                      const row = (t: DigitalCredentialType, label: string, c: DigitalCredential | null) => (
                        <span key={t} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="font-semibold text-slate-300">{label}:</span>
                          {!c && revokedCount === 0 && (
                            <span className="text-slate-500">Não emitido</span>
                          )}
                          {!c && revokedCount > 0 && (
                            <span className="text-red-300">Revogado</span>
                          )}
                          {c && (
                            <span className="font-mono text-gold-300" title={`Emitido em ${new Date(c.issued_at).toLocaleString('pt-PT')}`}>
                              {c.verification_code}
                            </span>
                          )}
                        </span>
                      );
                      return (
                        <span className="flex min-w-44 flex-col gap-1.5">
                          {row('certificate', 'Certificado', cert)}
                          {row('digital_seal', 'Selo digital', seal)}
                          <span className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setCredentialTarget(d)}
                              disabled={!hasCampaign}
                              title={creds.length > 0 ? 'Ver credenciais' : 'Gerar credencial'}
                              className="inline-flex items-center gap-1 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs font-semibold text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
                            >
                              {creds.length > 0 ? 'Ver credenciais' : 'Gerar credencial'}
                            </button>
                          </span>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'package',
                    label: 'Pacote Digital',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const adoption = packageByDistinction[d.id] ?? null;
                      const busy = packageBusyId === d.id;
                      if (!adoption) {
                        return (
                          <span className="flex min-w-44 flex-col gap-1.5">
                            <span className="text-[11px] text-slate-500" title="Sem adesão registada">—</span>
                            <button
                              type="button"
                              onClick={() => setPackageTarget(d)}
                              disabled={!hasCampaign}
                              title="Registar adesão ao Pacote Oficial Digital"
                              className="inline-flex w-fit items-center gap-1 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs font-semibold text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
                            >
                              Registar adesão
                            </button>
                          </span>
                        );
                      }
                      return (
                        <span className="flex min-w-44 flex-col gap-1.5">
                          <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${packagePillClass(adoption.status)}`}>
                            {PACKAGE_ADOPTION_STATUS_LABELS[adoption.status] ?? adoption.status}
                          </span>
                          <span className="text-[11px] text-slate-400" title={`${adoption.package_code} · ${formatPriceCents(adoption.price_cents, adoption.currency)}`}>
                            {adoption.package_code} · {formatPriceCents(adoption.price_cents, adoption.currency)}
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            {adoption.status !== 'cancelled' ? (
                              <button
                                type="button"
                                onClick={() => handleCancelPackage(d, adoption)}
                                disabled={!hasCampaign || busy}
                                title="Cancelar adesão (preserva mérito, votos e vitória)"
                                className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40"
                              >
                                {busy ? '…' : 'Cancelar adesão'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleReactivatePackage(d, adoption)}
                                disabled={!hasCampaign || busy}
                                title="Reativar adesão"
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-40"
                              >
                                {busy ? '…' : 'Reativar'}
                              </button>
                            )}
                          </span>
                        </span>
                      );
                    },
                  },
                  {
                    key: 'notes',
                    label: 'Notas',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      const text = (d.notes ?? '').trim();
                      return text ? (
                        <span className="block max-w-52 truncate text-[11px] text-slate-300" title={text}>
                          {text}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-600">— sem notas (administrativas, sem exposição pública)</span>
                      );
                    },
                  },
                  {
                    key: 'updated_at',
                    label: 'Última atualização',
                    render: (r) => (
                      <span className="text-[11px] text-slate-500">
                        {new Date(String(r.updated_at)).toLocaleString('pt-PT')}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    label: 'Ações',
                    render: (r) => {
                      const d = r as unknown as AwardDistinction;
                      return (
                        <button
                          onClick={() => openNotes(d)}
                          disabled={!hasCampaign}
                          title={d.notes ? d.notes : 'Editar notas comerciais'}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
                        >
                          <StickyNote className="h-3 w-3" />
                          {d.notes ? 'Notas ✓' : 'Notas'}
                        </button>
                      );
                    },
                  },
                ]}
              />
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Recusa comercial (Recusado) apenas guarda o estado e a auditoria — nunca
                altera o mérito, nunca transfere prémios, nunca promove o segundo colocado,
                nunca altera votos ou rankings. {PACKAGE_NON_INTERFERENCE_NOTICE} O
                cancelamento da adesão nunca retira a vitória.
              </p>
            </AdminCard>
          </div>
        </>
      )}

      {confirm && (
        <Modal
          title="Criar distinção a partir do resultado"
          onClose={() => (creating ? null : setConfirm(null))}
        >
          <div className="space-y-3 text-sm">
            <FormError message={confirmError} />
            {confirmInfo && (
              <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                {confirmInfo}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <dt className="text-slate-500">Empresa</dt>
              <dd className="font-semibold text-white">{confirm.business_name}</dd>
              <dt className="text-slate-500">Cidade</dt>
              <dd className="text-slate-200">{cityById.get(confirm.city_id)?.name ?? '—'}</dd>
              <dt className="text-slate-500">Categoria</dt>
              <dd className="text-slate-200">{categoryById.get(confirm.category_id)?.name ?? '—'}</dd>
              <dt className="text-slate-500">Modalidade</dt>
              <dd className="text-slate-200">{modalityById.get(confirm.modality_id)?.name ?? '—'}</dd>
              <dt className="text-slate-500">Posição</dt>
              <dd className="text-slate-200">{confirm.position}.º (via get_admin_modality_tally)</dd>
              <dt className="text-slate-500">Votos</dt>
              <dd className="text-slate-200">{confirm.total_votes} (só leitura — não copiados)</dd>
              <dt className="text-slate-500">Origem</dt>
              <dd className="text-slate-200">Voto de modalidade (modality_vote)</dd>
            </dl>
            <p className="rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
              Será criada com mérito <strong className="text-white">Selecionado</strong> e
              comercial <strong className="text-white">Pendente</strong>, posição{' '}
              {confirm.position}.º, sem copiar votos.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={creating}
                className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateFromTally}
                disabled={creating || !isSupabaseConfigured}
                className="rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
              >
                {creating ? 'A criar…' : 'Confirmar criação'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {notesTarget && (
        <Modal title={`Notas comerciais — ${businessById.get(notesTarget.business_id)?.name ?? 'empresa'}`} onClose={() => setNotesTarget(null)}>
          <form onSubmit={handleSaveNotes} className="space-y-4">
            <FormError message={notesError} />
            <Field label="Notas (ex.: contactado por telefone em 20/09)">
              <TextArea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                placeholder="Notas da relação comercial…"
              />
            </Field>
            <FormActions onCancel={() => setNotesTarget(null)} saving={savingNotes} saveLabel="Guardar notas" />
          </form>
        </Modal>
      )}

      {/* FASE 5C.3.12 — gerir reconhecimento/entrega (quarta dimensão).
          Escreve SOMENTE em distinction_fulfillment; nunca altera mérito,
          comercial, votos, ranking ou resultados públicos. */}
      {fulfillmentTarget && (
        <FulfillmentManager
          distinction={fulfillmentTarget}
          businessName={businessById.get(fulfillmentTarget.business_id)?.name ?? 'empresa'}
          items={fulfillmentByDistinction[fulfillmentTarget.id] ?? []}
          hasCampaign={hasCampaign}
          onChanged={() => {
            fulfillmentQuery.refetch();
          }}
          onClose={() => setFulfillmentTarget(null)}
        />
      )}

      {/* FASE 5C.3.13 + 5C.3.14 — emitir/revogar credenciais verificáveis +
          motor visual (pré-visualizar/descarregar/verificar). A geração de
          ficheiro é efeito visual client-side (template + credential data),
          nunca altera mérito, comercial, fulfillment, votos, ranking,
          resultados, nem escreve em Storage. */}
      {credentialTarget && (
        <CredentialManager
          distinction={credentialTarget}
          businessName={businessById.get(credentialTarget.business_id)?.name ?? 'empresa'}
          credentials={credentialsByDistinction[credentialTarget.id] ?? []}
          fulfillmentItems={fulfillmentByDistinction[credentialTarget.id] ?? []}
          campaignYear={selectedCampaign?.year ?? null}
          campaignName={selectedCampaign?.name ?? null}
          cityName={cityById.get(credentialTarget.city_id)?.name ?? '—'}
          categoryName={categoryById.get(credentialTarget.category_id)?.name ?? '—'}
          modalityName={modalityById.get(credentialTarget.modality_id)?.name ?? null}
          distinctionLabel={modalityById.get(credentialTarget.modality_id)?.name ?? categoryById.get(credentialTarget.category_id)?.name ?? 'Distinção'}
          programName={selectedProgram?.name ?? 'Melhores do Ano Portugal'}
          programPrefix="pt"
          hasCampaign={hasCampaign}
          onChanged={() => {
            credentialsQuery.refetch();
          }}
          onClose={() => setCredentialTarget(null)}
        />
      )}

      {/* FASE 6.3.1 — registar adesão ao Pacote Oficial Digital (registo
          administrativo, sem pagamento). Escreve SOMENTE em
          distinction_package_adoptions; nunca altera mérito, comercial,
          votos, ranking, vencedor ou resultados públicos. */}
      {packageTarget && (
        <PackageAdoptionModal
          distinction={packageTarget}
          businessName={businessById.get(packageTarget.business_id)?.name ?? 'empresa'}
          cityName={cityById.get(packageTarget.city_id)?.name ?? '—'}
          categoryName={categoryById.get(packageTarget.category_id)?.name ?? '—'}
          modalityName={modalityById.get(packageTarget.modality_id)?.name ?? null}
          hasCampaign={hasCampaign}
          onChanged={() => {
            packageQuery.refetch();
          }}
          onClose={() => setPackageTarget(null)}
        />
      )}
    </div>
  );
}
