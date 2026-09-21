import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * FASE 4F.4 — preserva a mensagem original do Supabase/PostgREST.
 * Erros de `supabase.rpc()` são objectos simples { message, details, hint, code }
 * e NÃO instâncias de Error — o teste anterior `e instanceof Error` descartava-os
 * e caía sempre no genérico "Falha ao carregar os dados.".
 * Expõe apenas message/details/hint/code (sem stack trace nem dados sensíveis).
 */
function toQueryErrorMessage(e: unknown): string {
  const FALLBACK = 'Falha ao carregar os dados.';
  if (typeof e === 'string') {
    const trimmed = e.trim();
    return trimmed ? trimmed : FALLBACK;
  }
  if (typeof e === 'object' && e !== null) {
    const o = e as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const message = typeof o.message === 'string' ? o.message.trim() : '';
    const details = typeof o.details === 'string' ? o.details.trim() : '';
    const hint = typeof o.hint === 'string' ? o.hint.trim() : '';
    const code = typeof o.code === 'string' ? o.code.trim() : '';
    const extras: string[] = [];
    if (details) extras.push(`details: ${details}`);
    if (hint) extras.push(`hint: ${hint}`);
    if (code) extras.push(`code: ${code}`);
    if (message && extras.length > 0) return `${message} (${extras.join(' | ')})`;
    if (message) return message;
    if (extras.length > 0) return extras.join(' | ');
  }
  if (e instanceof Error) {
    return e.message ? e.message : FALLBACK;
  }
  return FALLBACK;
}

/**
 * Hook genérico Supabase-first com fallback local.
 * - Se o Supabase estiver configurado, consulta a BD (fonte de verdade).
 * - Caso contrário / em erro, utiliza `fallback` para o preview renderizar.
 * - `deps`: dependências reactivas (ex.: IDs resolvidos de forma assíncrona).
 *   Quando mudam, a consulta re-executa — evita dados obsoletos quando
 *   a campanha/cidade chega depois da primeira renderização.
 */
export function usePublicQuery<T>(fetcher: () => Promise<T>, fallback: T, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = JSON.stringify(deps);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      if (!supabase) {
        // Sem configuração: preview imediato com dados de recurso.
        await new Promise((r) => setTimeout(r, 350));
        if (!cancelled) {
          setData(fallback);
          setLoading(false);
        }
        return;
      }
      try {
        // Timeout de segurança: nenhuma consulta pública pode travar o
        // preview além de 8s — cai para o fallback e renderiza.
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tempo limite ao carregar dados.')), 8000),
        );
        const result = await Promise.race([fetcher(), timeout]);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) {
          // FASE 4F.4: propaga o erro original do Supabase (message/details/hint/code).
          setError(toQueryErrorMessage(e));
          setData(fallback);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, key]);

  return { data, loading, error, refetch };
}

export { supabase };
