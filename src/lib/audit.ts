import { supabase } from './supabase';

/**
 * Regista uma acção administrativa em `audit_logs`.
 * Falha silenciosamente em modo de demonstração (sem Supabase)
 * para nunca bloquear a interface — mas regista em consola.
 */
export async function audit(
  action: string,
  entity: string | null,
  entityId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!supabase) {
    console.info('[audit:demo]', { action, entity, entityId, metadata });
    return;
  }
  try {
    const { data } = await supabase.auth.getUser();
    const actorId = data.user?.id ?? null;
    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      metadata: metadata ?? null,
    });
  } catch (e) {
    console.warn('[audit] falha ao registar:', e);
  }
}
