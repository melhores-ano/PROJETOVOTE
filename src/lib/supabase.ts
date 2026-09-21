import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

/**
 * Detecta URLs/keys de placeholder (preview local, exemplos, templates).
 * Nesses casos o cliente NUNCA deve tentar rede — a app usa fallback local
 * e renderiza instantaneamente em vez de pendurar em timeout de DNS.
 */
function isPlaceholder(value: string): boolean {
  const v = value.toLowerCase();
  if (!v) return true;
  return (
    v.includes('codein-local') ||
    v.includes('codein-mock') ||
    v.includes('placeholder') ||
    v.includes('example') ||
    v.includes('<project-ref>') ||
    v.includes('<anon') ||
    v.includes('your-') ||
    v === 'codein-mock-value'
  );
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const isSupabaseConfigured =
  Boolean(rawUrl && rawKey) &&
  !isPlaceholder(rawUrl) &&
  !isPlaceholder(rawKey) &&
  isValidHttpUrl(rawUrl) &&
  rawKey.length > 32;

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  try {
    client = createClient(rawUrl, rawKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      global: {
        // Evita que o preview trave em hosts inalcançáveis.
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
      },
    });
  } catch (err) {
    console.warn('[supabase] Falha ao criar cliente, usando fallback local:', err);
    client = null;
  }
} else if (rawUrl || rawKey) {
  console.info('[supabase] Variáveis de placeholder detectadas — modo fallback local activo.');
}

/**
 * Cliente Supabase público (anon key). Nulo quando as variáveis de
 * ambiente ainda não foram configuradas — nesse caso a app utiliza
 * os dados de recurso locais em `src/data/fallback.ts` para o preview.
 */
export const supabase: SupabaseClient | null = client;
