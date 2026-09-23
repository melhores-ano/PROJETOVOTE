import { supabase } from './supabase';
import { audit } from './audit';
import type {
  InvitationContactMethod,
  InvitationStatus,
  ParticipantInvitation,
} from '../types/database';

/**
 * FASE 6.1 — Convites e aceitação de participantes (pré-votação).
 * Camada de aplicação sobre public.participant_invitations (migration 0018).
 *
 * REGRAS INEGOCIÁVEIS:
 * - Contactar/aceitar NUNCA cria campaign_entry (só confirmar cria/associa).
 * - Confirmar exige status anterior `accepted` + campanha/cidade/categoria/
 *   empresa válidos; cria ou reutiliza campaign_entry de forma idempotente
 *   (UNIQUE existente como barreira final; 23505 = "já existe, reutilizar").
 * - NUNCA escreve em votes / vote_attempts / vote_adjustments /
 *   modality_votes / resultados / distinções / fulfillment / credentials.
 * - contact_person / notes / acceptance_reference são internos (admin-only).
 */

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  potential: 'Potencial',
  contacted: 'Contactada',
  accepted: 'Aceitou participar',
  declined: 'Recusou',
  confirmed: 'Confirmada para votação',
};

export const INVITATION_STATUS_ORDER: InvitationStatus[] = [
  'potential',
  'contacted',
  'accepted',
  'declined',
  'confirmed',
];

export const INVITATION_CONTACT_METHOD_LABELS: Record<InvitationContactMethod, string> = {
  phone: 'Telefone',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  in_person: 'Presencial',
  other: 'Outra',
};

export const INVITATION_AUDIT_ACTIONS = {
  created: 'participant_invitation.created',
  contacted: 'participant_invitation.contacted',
  accepted: 'participant_invitation.accepted',
  declined: 'participant_invitation.declined',
  confirmed: 'participant_invitation.confirmed',
  updated: 'participant_invitation.updated',
} as const;

/** Transições permitidas no funil (confirmed é terminal). */
const ALLOWED_TRANSITIONS: Record<InvitationStatus, InvitationStatus[]> = {
  potential: ['contacted'],
  contacted: ['accepted', 'declined'],
  accepted: ['confirmed', 'declined'],
  declined: ['contacted'],
  confirmed: [],
};

export function canTransition(from: InvitationStatus, to: InvitationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function invitationStatusLabel(status: string): string {
  return (INVITATION_STATUS_LABELS as Record<string, string>)[status] ?? String(status);
}

export function contactMethodLabel(method: string | null | undefined): string {
  if (!method) return '—';
  return (INVITATION_CONTACT_METHOD_LABELS as Record<string, string>)[method] ?? String(method);
}

export interface InvitationScope {
  campaign_id: string;
  city_id: string;
  category_id: string;
  business_id: string;
}

export interface CreateInvitationInput extends InvitationScope {
  status?: InvitationStatus;
  contact_method?: InvitationContactMethod | null;
  contact_person?: string | null;
  notes?: string | null;
  acceptance_reference?: string | null;
}

export interface UpdateInvitationInput {
  contact_method?: InvitationContactMethod | null;
  contact_person?: string | null;
  notes?: string | null;
  acceptance_reference?: string | null;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
  }
  return supabase;
}

async function currentActorId(): Promise<string | null> {
  try {
    const { data } = await requireSupabase().auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function cleanOptionalText(v: string | null | undefined): string | null {
  if (v === undefined) return null;
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
}

/**
 * FASE 6.1.1 — Junção segura de notas internas (sem destruir informação).
 * Se já existirem notas e for acrescentada uma nova, anexa com separador
 * e carimbo temporal; caso contrário devolve a parte não vazia.
 * Usado na transição para `accepted` para preservar o histórico de contacto.
 */
export function mergeInvitationNotes(
  previous: string | null | undefined,
  addition: string | null | undefined,
): string | null {
  const oldText = String(previous ?? '').trim();
  const newText = String(addition ?? '').trim();
  if (!oldText) return newText === '' ? null : newText;
  if (!newText) return oldText;
  if (oldText.includes(newText)) return oldText;
  const stamp = new Date().toLocaleString('pt-PT');
  return `${oldText}\n\n— [${stamp}] ${newText}`;
}

/** Cria um convite em estado `potential` (ou `contacted` se já contactado). */
export async function createInvitation(input: CreateInvitationInput): Promise<{ id: string }> {
  const db = requireSupabase();
  if (!input.campaign_id || !input.city_id || !input.category_id || !input.business_id) {
    throw new Error('Edição, cidade, categoria e empresa são obrigatórios.');
  }
  const status: InvitationStatus = input.status ?? 'potential';
  if (status !== 'potential' && status !== 'contacted') {
    throw new Error('Um novo convite só pode nascer como Potencial ou Contactada.');
  }
  const actorId = await currentActorId();
  const payload = {
    campaign_id: input.campaign_id,
    city_id: input.city_id,
    category_id: input.category_id,
    business_id: input.business_id,
    status,
    contact_method: input.contact_method ?? null,
    contact_person: cleanOptionalText(input.contact_person),
    notes: cleanOptionalText(input.notes),
    acceptance_reference: cleanOptionalText(input.acceptance_reference),
    contacted_at: status === 'contacted' ? new Date().toISOString() : null,
    created_by: actorId,
    updated_by: actorId,
  };
  const { data, error } = await db.from('participant_invitations').insert(payload).select('id').single();
  if (error) {
    if (String((error as { code?: string }).code) === '23505' || /duplicate|unique/i.test(error.message)) {
      throw new Error('Já existe um convite para esta edição × cidade × categoria × empresa.');
    }
    throw error;
  }
  const id = (data as { id: string }).id;
  await audit(INVITATION_AUDIT_ACTIONS.created, 'participant_invitations', id, {
    ...input,
    status,
  });
  return { id };
}

/** Edita apenas os campos internos (forma de contacto, pessoa, notas, referência). */
export async function updateInvitationNotes(
  id: string,
  patch: UpdateInvitationInput,
): Promise<void> {
  const db = requireSupabase();
  const actorId = await currentActorId();
  const payload: Record<string, unknown> = { updated_by: actorId };
  if (patch.contact_method !== undefined) payload.contact_method = patch.contact_method;
  if (patch.contact_person !== undefined) payload.contact_person = cleanOptionalText(patch.contact_person);
  if (patch.notes !== undefined) payload.notes = cleanOptionalText(patch.notes);
  if (patch.acceptance_reference !== undefined) {
    payload.acceptance_reference = cleanOptionalText(patch.acceptance_reference);
  }
  const { error } = await db.from('participant_invitations').update(payload).eq('id', id);
  if (error) throw error;
  await audit(INVITATION_AUDIT_ACTIONS.updated, 'participant_invitations', id, { ...patch });
}

/** Transição genérica do funil (contacted / accepted / declined). */
export async function transitionInvitation(
  invitation: ParticipantInvitation,
  to: InvitationStatus,
  opts?: UpdateInvitationInput,
): Promise<void> {
  const db = requireSupabase();
  if (!canTransition(invitation.status, to)) {
    throw new Error(
      `Transição inválida: «${invitationStatusLabel(invitation.status)}» → «${invitationStatusLabel(to)}».`,
    );
  }
  if (invitation.status === 'confirmed') {
    throw new Error('Um convite confirmado para votação é terminal e não pode regredir.');
  }
  if ((to === 'contacted' || to === 'accepted') && !opts?.contact_method && !invitation.contact_method) {
    throw new Error('Indique a forma de contacto (telefone, WhatsApp, e-mail, presencial ou outra).');
  }
  const now = new Date().toISOString();
  const actorId = await currentActorId();
  const payload: Record<string, unknown> = {
    status: to,
    updated_by: actorId,
  };
  if (opts?.contact_method !== undefined) payload.contact_method = opts.contact_method;
  else if (to !== 'declined' && !invitation.contact_method) payload.contact_method = 'other';
  if (opts?.contact_person !== undefined) payload.contact_person = cleanOptionalText(opts.contact_person);
  // FASE 6.1.1 — nunca destruir notas: em `accepted`, anexar de forma segura.
  if (opts?.notes !== undefined) {
    const cleaned = cleanOptionalText(opts.notes);
    if (to === 'accepted' && cleaned) {
      payload.notes = mergeInvitationNotes(invitation.notes, cleaned);
    } else if (to === 'accepted' && cleaned === null) {
      // Nota vazia em `accepted` = preservar histórico (não apagar).
    } else {
      payload.notes = cleaned;
    }
  }
  if (opts?.acceptance_reference !== undefined) {
    payload.acceptance_reference = cleanOptionalText(opts.acceptance_reference);
  }
  if (to === 'contacted') {
    payload.contacted_at = invitation.contacted_at ?? now;
    // Re-contacto após recusa: limpa o marco de recusa.
    if (invitation.status === 'declined') payload.declined_at = null;
  }
  if (to === 'accepted') {
    payload.contacted_at = invitation.contacted_at ?? now;
    payload.accepted_at = now;
  }
  if (to === 'declined') {
    payload.declined_at = now;
  }
  const { error } = await db.from('participant_invitations').update(payload).eq('id', invitation.id);
  if (error) throw error;
  const action =
    to === 'contacted'
      ? INVITATION_AUDIT_ACTIONS.contacted
      : to === 'accepted'
        ? INVITATION_AUDIT_ACTIONS.accepted
        : INVITATION_AUDIT_ACTIONS.declined;
  await audit(action, 'participant_invitations', invitation.id, {
    from: invitation.status,
    to,
    campaign_id: invitation.campaign_id,
    city_id: invitation.city_id,
    category_id: invitation.category_id,
    business_id: invitation.business_id,
  });
}

/**
 * Confirmação para votação (passo crítico da Fase 6.1):
 * 1. verifica que o estado anterior é `accepted`;
 * 2. verifica campanha/cidade/categoria/empresa;
 * 3. cria ou reutiliza campaign_entry de forma segura e idempotente;
 * 4. evita duplicações (SELECT + UNIQUE como barreira final);
 * 5. atualiza o convite para `confirmed`;
 * 6. guarda confirmed_at + campaign_entry_id;
 * 7. gera audit log.
 * Se já existir campaign_entry compatível, NÃO duplica.
 */
export async function confirmInvitationForVoting(
  invitation: ParticipantInvitation,
): Promise<{ campaign_entry_id: string; reused: boolean }> {
  const db = requireSupabase();
  if (invitation.status !== 'accepted') {
    throw new Error(
      `Só é possível confirmar para votação um convite que tenha aceitado participar (estado actual: «${invitationStatusLabel(invitation.status)}»).`,
    );
  }
  if (!invitation.campaign_id || !invitation.city_id || !invitation.category_id || !invitation.business_id) {
    throw new Error('Convite inválido — edição, cidade, categoria e empresa são obrigatórios (fail-closed).');
  }
  if (invitation.campaign_entry_id) {
    throw new Error('Este convite já está confirmado para votação.');
  }

  // 1. Reutilizar entry compatível existente (idempotência por leitura).
  const { data: existing, error: existingError } = await db
    .from('campaign_entries')
    .select('id')
    .eq('campaign_id', invitation.campaign_id)
    .eq('city_id', invitation.city_id)
    .eq('category_id', invitation.category_id)
    .eq('business_id', invitation.business_id)
    .maybeSingle();
  if (existingError) throw existingError;

  let entryId = (existing as { id: string } | null)?.id ?? null;
  let reused = Boolean(entryId);

  // 2. Criar entry apenas se não existir (UNIQUE como barreira final).
  if (!entryId) {
    const { data: created, error: createError } = await db
      .from('campaign_entries')
      .insert({
        campaign_id: invitation.campaign_id,
        city_id: invitation.city_id,
        category_id: invitation.category_id,
        business_id: invitation.business_id,
        active: true,
        featured: false,
        position: 0,
      })
      .select('id')
      .single();
    if (createError) {
      // Corrida benigna: outra confirmação criou a entry primeiro → reutilizar.
      if (String((createError as { code?: string }).code) === '23505' || /duplicate|unique/i.test(createError.message)) {
        const { data: retry, error: retryError } = await db
          .from('campaign_entries')
          .select('id')
          .eq('campaign_id', invitation.campaign_id)
          .eq('city_id', invitation.city_id)
          .eq('category_id', invitation.category_id)
          .eq('business_id', invitation.business_id)
          .single();
        if (retryError || !retry) throw createError;
        entryId = (retry as { id: string }).id;
        reused = true;
      } else {
        throw createError;
      }
    } else {
      entryId = (created as { id: string }).id;
      reused = false;
      await audit('entry.create', 'campaign_entries', entryId, {
        campaign_id: invitation.campaign_id,
        city_id: invitation.city_id,
        category_id: invitation.category_id,
        business_id: invitation.business_id,
        via: 'participant_invitation.confirmed',
        invitation_id: invitation.id,
      });
    }
  }

  if (!entryId) throw new Error('Falha ao associar a participação efectiva (fail-closed).');

  // 3. Marcar o convite como confirmado (CHECK da BD exige entry + data).
  const now = new Date().toISOString();
  const actorId = await currentActorId();
  const { error: updateError } = await db
    .from('participant_invitations')
    .update({
      status: 'confirmed',
      confirmed_at: now,
      campaign_entry_id: entryId,
      updated_by: actorId,
    })
    .eq('id', invitation.id)
    .eq('status', 'accepted');
  if (updateError) throw updateError;

  await audit(INVITATION_AUDIT_ACTIONS.confirmed, 'participant_invitations', invitation.id, {
    from: 'accepted',
    to: 'confirmed',
    campaign_id: invitation.campaign_id,
    city_id: invitation.city_id,
    category_id: invitation.category_id,
    business_id: invitation.business_id,
    campaign_entry_id: entryId,
    entry_reused: reused,
  });

  return { campaign_entry_id: entryId, reused };
}

/** Contadores por categoria (potenciais/contactados/aceites/recusados/confirmados). */
export interface CategoryInvitationSummary {
  category_id: string;
  potential: number;
  contacted: number;
  accepted: number;
  declined: number;
  confirmed: number;
  total: number;
}

export function summarizeByCategory(
  invitations: Pick<ParticipantInvitation, 'category_id' | 'status'>[],
): CategoryInvitationSummary[] {
  const map = new Map<string, CategoryInvitationSummary>();
  for (const inv of invitations) {
    let row = map.get(inv.category_id);
    if (!row) {
      row = {
        category_id: inv.category_id,
        potential: 0,
        contacted: 0,
        accepted: 0,
        declined: 0,
        confirmed: 0,
        total: 0,
      };
      map.set(inv.category_id, row);
    }
    if (inv.status === 'potential') row.potential += 1;
    else if (inv.status === 'contacted') row.contacted += 1;
    else if (inv.status === 'accepted') row.accepted += 1;
    else if (inv.status === 'declined') row.declined += 1;
    else if (inv.status === 'confirmed') row.confirmed += 1;
    row.total += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
