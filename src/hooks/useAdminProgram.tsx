/**
 * THE BEST EUROPA — FASE 5C.3.6 — Contexto administrativo central.
 *
 * Única fonte de verdade para o Admin sobre as duas dimensões independentes:
 *   1. PROGRAMA (award_programs)
 *   2. EDIÇÃO   (campaigns do programa selecionado)
 *
 * Regras:
 * - Nenhum UUID hardcoded. Programas resolvem-se pelos dados (award_programs).
 * - Edições listadas SOMENTE do programa selecionado, ano desc.
 * - Troca de programa: limpa campanha incompatível, nunca reutiliza
 *   campaign_id de outro programa. FAIL-CLOSED quando inválido.
 * - Criar campanha ≠ ativar campanha. Ativação é explícita e atualiza
 *   SOMENTE site_settings(active_campaign_slug, award_program_id).
 * - Nova edição NUNCA copia votes / vote_attempts / vote_adjustments /
 *   resultados / auditoria — apenas INSERT na tabela campaigns.
 * - Persistência localStorage validada contra os dados atuais.
 * - Migration 0014 NÃO necessária: 0011 (award_programs, campaigns.
 *   award_program_id, UNIQUE(programa,ano)) + 0012 (site_settings.
 *   award_program_id + active_campaign_slug por programa) já cobrem tudo.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { audit } from '../lib/audit';
import { slugify } from '../lib/utils';
import { fallbackCampaign } from '../data/fallback';
import type { AwardProgram, Campaign, CampaignStatus } from '../types/database';

export interface AdminProgramState {
  programs: AwardProgram[];
  selectedProgram: AwardProgram | null;
  selectedProgramId: string | null;
  campaigns: Campaign[];
  selectedCampaign: Campaign | null;
  selectedCampaignId: string | null;
  /** Slug público ativo do programa (site_settings.active_campaign_slug). */
  activeCampaignSlug: string | null;
  /** Campanha correspondente ao slug ativo (pode ser null). */
  activeCampaign: Campaign | null;
  loading: boolean;
  error: string | null;
  setSelectedProgram: (id: string) => void;
  setSelectedCampaign: (id: string) => void;
  refresh: () => void;
  /** Label amigável para estados existentes (sem inventar estados). */
  campaignStatusLabel: (status: CampaignStatus | string) => string;
  /** true quando a campanha indicada é a edição ativa do programa. */
  isActiveCampaign: (campaign: Campaign | null | undefined) => boolean;
}

const AdminProgramContext = createContext<AdminProgramState | null>(null);

const LS_PROGRAM_KEY = 'tbe_admin_program_id';
const LS_CAMPAIGN_KEY = 'tbe_admin_campaign_id';

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  activa: 'Activa',
  votacao: 'Votação',
  encerrada: 'Encerrada',
  arquivada: 'Arquivada',
};

export function campaignStatusLabel(status: CampaignStatus | string): string {
  return STATUS_LABELS[String(status)] ?? String(status);
}

/** Fallback local preview (sem Supabase): programa + edição PT 2026. */
const FALLBACK_PROGRAM: AwardProgram = {
  id: '00000000-0000-4000-8000-00000000pt00',
  country_code: 'PT',
  name: 'Melhores do Ano Portugal',
  slug: 'melhores-do-ano-portugal',
  locale: 'pt-PT',
  active: true,
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
};

function readLS(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* armazenamento indisponível — ignora */
  }
}

export function AdminProgramProvider({ children }: { children: ReactNode }) {
  const [programs, setPrograms] = useState<AwardProgram[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedProgramId, setSelectedProgramIdState] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignIdState] = useState<string | null>(null);
  const [activeCampaignSlug, setActiveCampaignSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const initialized = useRef(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!supabase || !isSupabaseConfigured) {
          // Preview sem backend: programa + edição PT locais.
          if (!cancelled) {
            setPrograms([FALLBACK_PROGRAM]);
            setCampaigns([{ ...fallbackCampaign, award_program_id: FALLBACK_PROGRAM.id }]);
            setSelectedProgramIdState((prev) => prev ?? FALLBACK_PROGRAM.id);
            setSelectedCampaignIdState((prev) => prev ?? fallbackCampaign.id);
            setActiveCampaignSlug(fallbackCampaign.slug);
          }
          return;
        }

        // 1. Programas ativos (seletor preparado para futuros programas).
        const { data: programRows, error: programError } = await supabase
          .from('award_programs')
          .select('*')
          .eq('active', true)
          .order('name', { ascending: true });
        if (programError) throw programError;
        const programList = ((programRows ?? []) as AwardProgram[]).filter(
          (p) => p && typeof p.id === 'string' && p.id.length > 0,
        );
        if (cancelled) return;
        setPrograms(programList);

        // 2. Validar programa persistido; FAIL-CLOSED (nunca fallback silencioso
        // para Portugal quando existe seleção inválida e há programas válidos —
        // escolhe-se explicitamente o primeiro por ordem alfabética).
        const persistedProgram = readLS(LS_PROGRAM_KEY);
        let programId: string | null = null;
        if (persistedProgram && programList.some((p) => p.id === persistedProgram)) {
          programId = persistedProgram;
        } else if (!initialized.current && persistedProgram) {
          // Seleção guardada inválida → descarta.
          writeLS(LS_PROGRAM_KEY, null);
          writeLS(LS_CAMPAIGN_KEY, null);
        }
        if (programList.length === 0) {
          // FAIL-CLOSED: sem programa válido, sem dados.
          setCampaigns([]);
          setSelectedProgramIdState(null);
          setSelectedCampaignIdState(null);
          setActiveCampaignSlug(null);
          return;
        }
        if (!programId) {
          programId = programList[0].id;
        }
        if (cancelled) return;
        setSelectedProgramIdState(programId);
        writeLS(LS_PROGRAM_KEY, programId);

        // 3. Edições SOMENTE do programa selecionado, ano mais recente primeiro.
        const { data: campaignRows, error: campaignError } = await supabase
          .from('campaigns')
          .select('*')
          .eq('award_program_id', programId)
          .order('year', { ascending: false });
        if (campaignError) throw campaignError;
        const campaignList = ((campaignRows ?? []) as Campaign[]).filter(
          (c) => c && typeof c.id === 'string' && c.award_program_id === programId,
        );
        if (cancelled) return;
        setCampaigns(campaignList);

        // 4. Edição ativa do programa (site_settings por programa).
        let slug: string | null = null;
        try {
          const { data: settingRow } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'active_campaign_slug')
            .eq('award_program_id', programId)
            .maybeSingle();
          const v = (settingRow as { value: unknown } | null)?.value;
          slug = typeof v === 'string' && v.trim() !== '' ? v : null;
        } catch {
          slug = null;
        }
        if (cancelled) return;
        setActiveCampaignSlug(slug);

        // 5. Validar campanha persistida contra o programa atual.
        const persistedCampaign = readLS(LS_CAMPAIGN_KEY);
        let campaignId: string | null = null;
        if (
          persistedCampaign &&
          campaignList.some((c) => c.id === persistedCampaign)
        ) {
          campaignId = persistedCampaign;
        } else if (persistedCampaign) {
          writeLS(LS_CAMPAIGN_KEY, null);
        }
        if (!campaignId && campaignList.length > 0) {
          // Preferir a edição ativa; senão a mais recente.
          const active = slug
            ? (campaignList.find((c) => c.slug === slug) ?? null)
            : null;
          campaignId = (active ?? campaignList[0]).id;
        }
        if (cancelled) return;
        setSelectedCampaignIdState(campaignId);
        writeLS(LS_CAMPAIGN_KEY, campaignId);
        initialized.current = true;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar o contexto administrativo.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const setSelectedProgram = useCallback((id: string) => {
    // Troca de programa: limpar campanha incompatível IMEDIATAMENTE
    // (fail-closed) e recarregar campanhas do novo programa.
    writeLS(LS_PROGRAM_KEY, id);
    writeLS(LS_CAMPAIGN_KEY, null);
    setSelectedCampaignIdState(null);
    setCampaigns([]);
    setActiveCampaignSlug(null);
    setSelectedProgramIdState(id);
    initialized.current = true;
    // Força recarga das campanhas + slug ativo do novo programa.
    setNonce((n) => n + 1);
  }, []);

  const setSelectedCampaign = useCallback((id: string) => {
    // Nunca aceitar campaign_id de outro programa (defesa em profundidade).
    // A validação estrita acontece no efeito; aqui regista-se a intenção.
    setSelectedCampaignIdState((prev) => {
      if (prev === id) return prev;
      writeLS(LS_CAMPAIGN_KEY, id);
      return id;
    });
  }, []);

  const value = useMemo<AdminProgramState>(() => {
    const selectedProgram = programs.find((p) => p.id === selectedProgramId) ?? null;
    // Fail-closed: campanha só é válida se pertencer ao programa selecionado.
    const selectedCampaign =
      selectedProgram && selectedCampaignId
        ? (campaigns.find(
            (c) => c.id === selectedCampaignId && c.award_program_id === selectedProgram.id,
          ) ?? null)
        : null;
    const activeCampaign = activeCampaignSlug
      ? (campaigns.find((c) => c.slug === activeCampaignSlug) ?? null)
      : null;
    return {
      programs,
      selectedProgram,
      selectedProgramId: selectedProgram ? selectedProgram.id : null,
      campaigns,
      selectedCampaign,
      selectedCampaignId: selectedCampaign ? selectedCampaign.id : null,
      activeCampaignSlug,
      activeCampaign,
      loading,
      error,
      setSelectedProgram,
      setSelectedCampaign,
      refresh,
      campaignStatusLabel,
      isActiveCampaign: (c) => Boolean(c && activeCampaignSlug && c.slug === activeCampaignSlug),
    };
  }, [
    programs,
    campaigns,
    selectedProgramId,
    selectedCampaignId,
    activeCampaignSlug,
    loading,
    error,
    setSelectedProgram,
    setSelectedCampaign,
    refresh,
  ]);

  // Guardar contra campaign_id de outro programa que tenha chegado via
  // setSelectedCampaign antes da recarga: se a seleção atual não pertence
  // ao programa, anula (fail-closed) em vez de mostrar dados cruzados.
  useEffect(() => {
    if (loading) return;
    if (selectedCampaignId && !value.selectedCampaign && campaigns.length > 0) {
      writeLS(LS_CAMPAIGN_KEY, null);
      setSelectedCampaignIdState((prev) => {
        if (prev === null) return prev;
        const stillValid = campaigns.some((c) => c.id === prev);
        return stillValid ? prev : null;
      });
    }
  }, [loading, selectedCampaignId, value.selectedCampaign, campaigns]);

  return <AdminProgramContext.Provider value={value}>{children}</AdminProgramContext.Provider>;
}

export function useAdminProgram(): AdminProgramState {
  const ctx = useContext(AdminProgramContext);
  if (!ctx) throw new Error('useAdminProgram deve ser usado dentro de <AdminProgramProvider>.');
  return ctx;
}

/** Versão opcional (páginas que também renderizam sem provider em testes). */
export function useOptionalAdminProgram(): AdminProgramState | null {
  return useContext(AdminProgramContext);
}

// ---------------------------------------------------------------------------
// Operações de edição (chamadas explicitamente pelo utilizador no Admin).
// Criar ≠ ativar. Nunca copiam votes / vote_attempts / vote_adjustments /
// resultados / auditoria — apenas INSERT em campaigns + audit log.
// ---------------------------------------------------------------------------

export interface CreateEditionInput {
  year: number;
  name: string;
  slug: string;
  start_at: string | null;
  end_at: string | null;
  status: CampaignStatus;
  /** Fundação futura "criar com base na edição anterior" — nesta fase apenas
   *  regista a intenção em auditoria; NÃO clona categorias/participações. */
  basedOnCampaignId?: string | null;
}

export async function createEdition(
  programId: string,
  input: CreateEditionInput,
): Promise<{ id: string }> {
  if (!supabase) throw new Error('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
  if (!programId) throw new Error('Programa inválido — fail-closed: sem programa não é possível criar edição.');
  const year = Math.trunc(Number(input.year));
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    throw new Error('Ano inválido (2020–2100).');
  }
  const name = input.name.trim();
  const slug = slugify(input.slug.trim());
  if (!name || !slug) throw new Error('Nome e slug são obrigatórios.');
  if (input.start_at && input.end_at && new Date(input.start_at) >= new Date(input.end_at)) {
    throw new Error('A data de fim deve ser posterior à data de início.');
  }
  // Barreira client-side contra duplicados (a autoridade é a UNIQUE
  // (award_program_id, year) na BD — violação devolve erro 23505).
  const { data: existing } = await supabase
    .from('campaigns')
    .select('id')
    .eq('award_program_id', programId)
    .eq('year', year)
    .limit(1);
  if (existing && existing.length > 0) {
    throw new Error(`Já existe uma edição ${year} neste programa. Uma edição encerrada nunca é apagada nem reutilizada — escolha outro ano.`);
  }
  const payload = {
    award_program_id: programId,
    name,
    slug,
    year,
    start_at: input.start_at ? new Date(input.start_at).toISOString() : null,
    end_at: input.end_at ? new Date(input.end_at).toISOString() : null,
    status: input.status,
    results_public: false,
  };
  const { data, error } = await supabase.from('campaigns').insert(payload).select('id').single();
  if (error) {
    if (String(error.message).includes('duplicate') || String((error as { code?: string }).code) === '23505') {
      throw new Error(`Já existe uma edição ${year} neste programa (constraint award_program_id + year).`);
    }
    throw error;
  }
  const id = (data as { id: string }).id;
  await audit('campaign.create', 'campaigns', id, {
    name,
    year,
    award_program_id: programId,
    ...(input.basedOnCampaignId ? { based_on: input.basedOnCampaignId, note: 'fundacao-5C.3.6: sem clonagem automatica; votos/resultados nunca copiados' } : {}),
  });
  return { id };
}

/**
 * Tornar edição ativa — ação explícita que atualiza SOMENTE site_settings
 * (key=active_campaign_slug, award_program_id=programa). Nunca apaga nem
 * desativa a campanha anterior; ela apenas deixa de ser a edição pública.
 */
export async function setActiveEdition(programId: string, campaign: Campaign): Promise<void> {
  if (!supabase) throw new Error('Supabase por configurar — acção desactivada em modo de demonstração.');
  if (!programId) throw new Error('Programa inválido — fail-closed.');
  if (!campaign || campaign.award_program_id !== programId) {
    throw new Error('A edição não pertence ao programa selecionado — activação recusada.');
  }
  // SELECT → UPDATE por id / INSERT (PostgREST/upsert por key global inválido
  // desde a 0012: unicidade parcial por programa).
  const { data: existing } = await supabase
    .from('site_settings')
    .select('id')
    .eq('key', 'active_campaign_slug')
    .eq('award_program_id', programId)
    .maybeSingle();
  const row = existing as { id: string } | null;
  if (row?.id) {
    const { error } = await supabase
      .from('site_settings')
      .update({ value: campaign.slug })
      .eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('site_settings').insert({
      key: 'active_campaign_slug',
      value: campaign.slug,
      award_program_id: programId,
      is_public: true,
    });
    if (error) throw error;
  }
  await audit('campaign.set_active', 'campaigns', campaign.id, {
    slug: campaign.slug,
    year: campaign.year,
    award_program_id: programId,
  });
}
