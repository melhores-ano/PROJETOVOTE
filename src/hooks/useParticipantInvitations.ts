import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { ParticipantInvitation } from '../types/database';

export interface InvitationFilters {
  campaign_id?: string;
  city_id?: string;
  category_id?: string;
  status?: string;
  search?: string;
}

interface UseInvitationsResult {
  rows: ParticipantInvitation[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * FASE 6.1 — Hook admin-only para listar participant_invitations.
 * - Admin-only (RLS gere no servidor; anon recebe 0 linhas, fail-closed).
 * - Sem backend → lista vazia (sem mock eleitoral; contadores a zero).
 * - Filtros client-side simples (edição/cidade/categoria/estado/pesquisa).
 */
export function useParticipantInvitations(filters: InvitationFilters = {}): UseInvitationsResult {
  const [rows, setRows] = useState<ParticipantInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const key = useMemo(
    () => JSON.stringify(filters) + `::${tick}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.campaign_id, filters.city_id, filters.category_id, filters.status, filters.search, tick],
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      if (!supabase || !isSupabaseConfigured) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      try {
        let q = supabase
          .from('participant_invitations')
          .select(
            '*, business:businesses(id,name,slug), city:cities(id,name,slug), category:categories(id,name,slug), campaign:campaigns(id,year,name)',
          )
          .order('updated_at', { ascending: false })
          .limit(2000);
        const f: InvitationFilters = JSON.parse(key.split('::')[0] || '{}');
        if (f.campaign_id) q = q.eq('campaign_id', f.campaign_id);
        if (f.city_id) q = q.eq('city_id', f.city_id);
        if (f.category_id) q = q.eq('category_id', f.category_id);
        if (f.status) q = q.eq('status', f.status);
        const { data, error: qErr } = await q;
        if (qErr) throw qErr;
        let list = (data ?? []) as unknown as ParticipantInvitation[];
        const term = (f.search ?? '').trim().toLowerCase();
        if (term) {
          list = list.filter((r) => {
            const b = String((r.business as unknown as { name?: string } | null)?.name ?? '').toLowerCase();
            const c = String((r.city as unknown as { name?: string } | null)?.name ?? '').toLowerCase();
            const k = String((r.category as unknown as { name?: string } | null)?.name ?? '').toLowerCase();
            const n = String(r.contact_person ?? '').toLowerCase();
            return b.includes(term) || c.includes(term) || k.includes(term) || n.includes(term);
          });
        }
        if (!cancelled) setRows(list);
      } catch (e) {
        // 42P01 = tabela ainda não migrada remotamente → vazio fail-closed.
        const msg = e instanceof Error ? e.message : String(e);
        if (/42P01|participant_invitations.*(does not exist|not exist)/i.test(msg)) {
          if (!cancelled) setRows([]);
        } else if (!cancelled) {
          setError(msg);
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
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, loading, error, reload };
}
