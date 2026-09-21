import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface LiveResultsState {
  /** true quando o websocket Realtime esta subscrito e saudavel. */
  live: boolean;
  /** Ultima atualizacao recebida via Realtime (ou polling fallback). */
  lastUpdate: Date | null;
}

interface UseLiveResultsOptions {
  /** Activo so quando os resultados estao visiveis (evita sockets ociosos). */
  enabled: boolean;
  /** Chamado quando chega um sinal live ou o polling fallback dispara. */
  onSignal?: () => void;
  /** Intervalo do polling fallback quando o websocket nao conecta (ms). */
  pollIntervalMs?: number;
  /**
   * FASE 5C.3.2: id do award_program actual (Portugal). Quando fornecido,
   * eventos `site_settings` de OUTRO programa são ignorados — pode ocorrer
   * refetch, mas os dados resultantes continuam filtrados pelo programa
   * actual nos hooks (useSiteConfig / useVotingSettings). `campaigns`
   * continua a emitir (a campanha valida o programa ao carregar).
   * Opcional para retrocompatibilidade (sem filtro quando omitido).
   */
  awardProgramId?: string | null;
}

/**
 * Resultados ao vivo (Supabase Realtime).
 *
 * - Assina `postgres_changes` em `campaigns` e `site_settings` — os unicos
 *   sinais que anon pode ler (ver migration 0008). `votes` NUNCA e assinado:
 *   anon nao tem leitura (RLS) e votos individuais nunca sao expostos; o
 *   placar e sempre o agregado `get_published_results`.
 * - FASE 5C.3.2: site_settings é global no Realtime (replica identity FULL),
 *   por isso o payload pode trazer linhas de outro programa — o filtro
 *   `awardProgramId` ignora esses eventos; o refetch seguinte usa apenas
 *   dados do programa actual. NUNCA assina votes, vote_attempts,
 *   vote_adjustments, audit_logs ou profiles.
 * - Sem Supabase configurado: `live=false`, sem sockets, sem timers.
 * - Se o websocket falhar (preview / rede restrita): polling de 30s como
 *   fallback, para que a pagina nunca fique obsoleta em silencio.
 * - Limpeza total no unmount (removeChannel) — sem leaks entre rotas.
 */
export function useLiveResults({
  enabled,
  onSignal,
  pollIntervalMs = 30_000,
  awardProgramId = null,
}: UseLiveResultsOptions): LiveResultsState {
  const [live, setLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const signalRef = useRef(onSignal);
  signalRef.current = onSignal;

  useEffect(() => {
    if (!enabled || !supabase) {
      setLive(false);
      return;
    }

    let cancelled = false;
    let channel: { unsubscribe: () => void } | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let settled = false;

    const emit = (via: 'realtime' | 'poll') => {
      if (cancelled) return;
      setLastUpdate(new Date());
      if (via === 'realtime') setLive(true);
      signalRef.current?.();
    };

    try {
      channel = supabase
        .channel('live-results')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'campaigns' },
          () => emit('realtime'),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_settings' },
          (payload: { new?: { award_program_id?: string | null }; old?: { award_program_id?: string | null } }) => {
            // FASE 5C.3.2: ignora mudanças de outro programa. Linhas
            // globais (NULL) emitem sempre; linhas do programa actual
            // emitem; linhas de outro programa são descartadas.
            if (awardProgramId !== null && awardProgramId !== undefined) {
              const next = payload?.new?.award_program_id ?? null;
              const prev = (payload as { old?: { award_program_id?: string | null } })?.old?.award_program_id ?? null;
              if (next !== null && next !== awardProgramId) return;
              if (next === null && prev !== null && prev !== awardProgramId) return;
            }
            emit('realtime');
          },
        )
        .subscribe((status) => {
          if (cancelled || settled) return;
          if (status === 'SUBSCRIBED') {
            settled = true;
            setLive(true);
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          }
        });
    } catch {
      channel = null;
    }

    // Fallback: se em 8s o socket nao confirmou, polling conservador.
    const fallbackTimer = setTimeout(() => {
      if (cancelled || settled) return;
      setLive(false);
      emit('poll');
      pollTimer = setInterval(() => emit('poll'), pollIntervalMs);
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      if (pollTimer) clearInterval(pollTimer);
      try {
        if (channel && supabase) void supabase.removeChannel(channel as never);
      } catch {
        /* ignora */
      }
      setLive(false);
    };
  }, [enabled, pollIntervalMs, awardProgramId]);

  return { live, lastUpdate };
}
