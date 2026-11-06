/**
 * Prémios Melhores do Ano Portugal — Phase 2 + FASE 5C.3.2
 * Definições públicas de votação (sem segredos).
 *
 * FASE 5C.3.2: voting_enabled + turnstile_enabled são overrides do
 * award_program Portugal (fallback global apenas se o override não
 * existir); turnstile_site_key é GLOBAL. Resolução via camada central
 * (slug, sem UUID hardcoded); linhas de outro programa nunca contaminam.
 * Em produção, falha de configuração bloqueia o voto (fail-closed).
 * Sem Supabase, o preview local mantém a simulação ativa.
 */
import { supabase, usePublicQuery } from './usePublicQuery';
import {
  buildProgramSettingsMap,
  resolveEffectiveProgram,
  type SiteSettingRow,
} from '../lib/awardProgram';
import { useOptionalProgramScope } from './useProgram';

export interface VotingSettings {
  votingEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
}

const FALLBACK_SETTINGS: VotingSettings = {
  votingEnabled: true,
  turnstileEnabled: false,
  turnstileSiteKey: '',
};

export function useVotingSettings() {
  return useVotingSettingsQuery();
}

function useVotingSettingsQuery() {
  const scope = useOptionalProgramScope();
  const scopeId = scope.program?.id ?? scope.status;
  return usePublicQuery<VotingSettings>(
    async () => {
      if (!supabase) throw new Error('no-supabase');
      const program = await resolveEffectiveProgram(supabase, scope);
      const programId = program?.id ?? null;
      const { data, error } = await supabase
        .from('site_settings')
        .select('key, value, award_program_id')
        .in('key', ['voting_enabled', 'turnstile_enabled', 'turnstile_site_key']);
      if (error) throw error;
      const rows = ((data ?? []) as SiteSettingRow[]).map((r) => ({
        key: r.key,
        value: r.value,
        award_program_id: r.award_program_id ?? null,
      }));
      const map = buildProgramSettingsMap(rows, programId);
      const asBool = (v: unknown, fb: boolean): boolean =>
        typeof v === 'boolean' ? v : typeof v === 'string' ? v === 'true' : fb;
      const rawKey = map.get('turnstile_site_key');
      const captchaEnabled = asBool(map.get('turnstile_enabled'), false);
      const siteKey =
        typeof rawKey === 'string' ? rawKey : String(rawKey ?? '');
      return {
        votingEnabled: asBool(map.get('voting_enabled'), false) && (!captchaEnabled || siteKey.length > 0),
        turnstileEnabled: captchaEnabled,
        turnstileSiteKey: siteKey,
      };
    },
    supabase ? { ...FALLBACK_SETTINGS, votingEnabled: false } : FALLBACK_SETTINGS,
    [scopeId],
  );
}
