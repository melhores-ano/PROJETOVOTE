/**
 * Prémios Melhores do Ano Portugal — Phase 2
 * Identificador anónimo de dispositivo, amigo da privacidade.
 *
 * - Gerado UMA vez (UUID v4) e guardado em localStorage (`mda_device_id`).
 * - Sem recolha invasiva de sinais do navegador: apenas um token opaco aleatório.
 * - Enviado à Edge Function cast-vote, que o transforma em HMAC-SHA256
 *   server-side (device_hash). O valor bruto nunca sai da BD como tal —
 *   só o hash é persistido.
 */

const STORAGE_KEY = 'mda_device_id';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fallback abaixo */
  }
  // Fallback UUID v4 manual (sem dependências).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isPlausibleId(v: string): boolean {
  return /^[0-9a-f-]{8,128}$/i.test(v);
}

/** Devolve o device ID persistente, criando-o na primeira visita. */
export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && isPlausibleId(existing)) return existing;
    const fresh = randomId();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Armazenamento indisponível (modo privado restrito): ID efémero.
    return randomId();
  }
}

/** Regenera o device ID (ex.: pedido "esquecer-me" / privacidade). */
export function resetDeviceId(): string {
  const fresh = randomId();
  try {
    window.localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    /* ignora — devolve efémero */
  }
  return fresh;
}
