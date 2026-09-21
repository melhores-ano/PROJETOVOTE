import { useEffect, useState } from 'react';
import { Save, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useSiteConfig } from '../../hooks/useDirectory';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  buildProgramSettingsMap,
  isProgramScopedKey,
  type SiteSettingRow,
} from '../../lib/awardProgram';
import { useAdminProgram } from '../../hooks/useAdminProgram';
import { audit } from '../../lib/audit';
import { AdminHeader, AdminCard, SupabaseNotice } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, TextInput, TextArea, Toggle, FormError } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

interface VotingDraft {
  votingEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  rateWindow: string;
  rateMaxAttempts: string;
  rateMaxVotes24h: string;
}

/**
 * FASE 5C.3.7 — Configurações isoladas por programa (arquitetura 0012).
 * Única fonte do programa: AdminProgramProvider (selectedProgramId).
 * Chaves POR PROGRAMA → award_program_id = selectedProgramId.
 * Chaves GLOBAIS → award_program_id IS NULL (THE BEST EUROPA).
 * active_campaign_slug continua POR PROGRAMA. Sem valores alterados
 * nesta fase — só o scope de leitura/escrita foi corrigido.
 */
export default function SettingsAdminPage() {
  const query = useSiteConfig();
  // 5C.3.7: programa via contexto Admin (nunca slug hardcoded PT).
  const { selectedProgram, selectedProgramId } = useAdminProgram();
  const hasProgram = Boolean(selectedProgram && selectedProgramId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<null | {
    siteName: string;
    activeCampaignSlug: string;
    maintenanceMode: boolean;
    resultsVisible: boolean;
    votingRules: string;
    tagline: string;
    primaryCta: string;
  }>(null);
  const [voting, setVoting] = useState<VotingDraft>({
    votingEnabled: true,
    turnstileEnabled: false,
    turnstileSiteKey: '',
    rateWindow: '600',
    rateMaxAttempts: '20',
    rateMaxVotes24h: '30',
  });
  const [votingLoaded, setVotingLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) {
        setVotingLoaded(true);
        return;
      }
      // 5C.3.7: fail-closed — sem programa válido não se resolve scope.
      if (!selectedProgramId) {
        setVotingLoaded(true);
        return;
      }
      try {
        // 5C.3.7: leitura com o programa SELECIONADO no Admin — o
        // override do programa tem prioridade sobre o fallback global.
        const programId = selectedProgramId;
        const { data } = await supabase
          .from('site_settings')
          .select('key, value, award_program_id')
          .in('key', [
            'voting_enabled',
            'turnstile_enabled',
            'turnstile_site_key',
            'vote_rate_window_seconds',
            'vote_rate_max_attempts',
            'vote_rate_max_votes_24h',
          ]);
        if (cancelled || !data) {
          setVotingLoaded(true);
          return;
        }
        const rows = ((data ?? []) as SiteSettingRow[]).map((r) => ({
          key: r.key,
          value: r.value,
          award_program_id: r.award_program_id ?? null,
        }));
        const map = buildProgramSettingsMap(rows, programId);
        const asBool = (v: unknown, fb: boolean): boolean =>
          typeof v === 'boolean' ? v : typeof v === 'string' ? v === 'true' : fb;
        setVoting({
          votingEnabled: asBool(map.get('voting_enabled'), true),
          turnstileEnabled: asBool(map.get('turnstile_enabled'), false),
          turnstileSiteKey: String(map.get('turnstile_site_key') ?? ''),
          rateWindow: String(map.get('vote_rate_window_seconds') ?? '600'),
          rateMaxAttempts: String(map.get('vote_rate_max_attempts') ?? '20'),
          rateMaxVotes24h: String(map.get('vote_rate_max_votes_24h') ?? '30'),
        });
      } catch {
        /* mantém defaults */
      } finally {
        if (!cancelled) setVotingLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProgramId]);

  if (query.loading) return <PageLoading label="A carregar configurações…" />;
  const cfg = query.data;
  if (!cfg) return <PageLoading label="Sem configurações." />;

  const values = draft ?? {
    siteName: cfg.siteName,
    activeCampaignSlug: cfg.activeCampaignSlug ?? '',
    maintenanceMode: cfg.maintenanceMode,
    resultsVisible: cfg.resultsVisible,
    votingRules: cfg.votingRules,
    tagline: cfg.branding.tagline,
    primaryCta: cfg.branding.primaryCta,
  };

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setDraft({ ...values, [key]: value });
    setSaved(false);
  }

  function setV<K extends keyof VotingDraft>(key: K, value: VotingDraft[K]) {
    setVoting({ ...voting, [key]: value });
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!supabase) {
      setError('Supabase por configurar — a escrita está desactivada em modo de demonstração.');
      return;
    }
    const rateWindow = Math.min(Math.max(parseInt(voting.rateWindow, 10) || 600, 60), 3600);
    const rateMax = Math.min(Math.max(parseInt(voting.rateMaxAttempts, 10) || 20, 1), 200);
    const rateDay = Math.min(Math.max(parseInt(voting.rateMaxVotes24h, 10) || 30, 1), 500);
    setSaving(true);
    try {
      // 5C.3.7: escrita segura sem `upsert(onConflict: 'key')` — os
      // UNIQUEs parciais (global + por programa) não são utilizáveis via
      // onConflict do PostgREST. Fluxo explícito SELECT → UPDATE por id /
      // INSERT, com award_program_id = programa SELECIONADO no Admin.
      // Chaves de programa → override do programa; chaves globais → NULL.
      // 0007: todas estas chaves sao de exposicao publica (UI + Edge via
      // service_role); a escrita inclui is_public=true para que linhas novas
      // nunca nasçam invisiveis ao publico. Segredos NUNCA passam por aqui.
      // active_campaign_slug continua POR PROGRAMA (arquitetura 0012).
      const programId = selectedProgramId;
      if (!programId) {
        throw new Error('Sem programa válido selecionado — fail-closed: gravação abortada. Selecione um programa no seletor global.');
      }
      const updates: { key: string; value: unknown; is_public: boolean }[] = [
        { key: 'site_name', value: values.siteName, is_public: true },
        { key: 'active_campaign_slug', value: values.activeCampaignSlug || null, is_public: true },
        { key: 'maintenance_mode', value: values.maintenanceMode, is_public: true },
        { key: 'results_visible', value: values.resultsVisible, is_public: true },
        { key: 'voting_rules', value: values.votingRules, is_public: true },
        { key: 'branding', value: { tagline: values.tagline, primaryCta: values.primaryCta }, is_public: true },
        { key: 'voting_enabled', value: voting.votingEnabled, is_public: true },
        { key: 'turnstile_enabled', value: voting.turnstileEnabled, is_public: true },
        { key: 'turnstile_site_key', value: voting.turnstileSiteKey.trim(), is_public: true },
        { key: 'vote_rate_window_seconds', value: rateWindow, is_public: true },
        { key: 'vote_rate_max_attempts', value: rateMax, is_public: true },
        { key: 'vote_rate_max_votes_24h', value: rateDay, is_public: true },
      ];
      for (const u of updates) {
        // Destino 5C.3.2: programa (override PT) ou global (NULL).
        const targetProgramId = isProgramScopedKey(u.key) ? programId : null;
        let existingQuery = supabase
          .from('site_settings')
          .select('id')
          .eq('key', u.key);
        existingQuery =
          targetProgramId === null
            ? existingQuery.is('award_program_id', null)
            : existingQuery.eq('award_program_id', targetProgramId);
        const { data: existing, error: selError } = await existingQuery.maybeSingle();
        if (selError) throw selError;
        const existingId = (existing as { id?: unknown } | null)?.id;
        if (typeof existingId === 'string' && existingId.length > 0) {
          const { error: updError } = await supabase
            .from('site_settings')
            .update({ value: u.value as never, is_public: u.is_public })
            .eq('id', existingId);
          if (updError) throw updError;
        } else {
          const { error: insError } = await supabase.from('site_settings').insert({
            key: u.key,
            value: u.value as never,
            is_public: u.is_public,
            award_program_id: targetProgramId,
          });
          if (insError) throw insError;
        }
      }
      await audit('settings.update', 'site_settings', null, {
        keys: updates.map((u) => u.key),
      });
      setSaved(true);
      query.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao guardar as configurações.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <AdminHeader title="Configurações" description={`Programa ${selectedProgram ? selectedProgram.name : '(sem programa válido)'} — overrides do programa (award_program_id) + globais THE BEST EUROPA (NULL). Todas as gravações são auditadas.`} />
      <SupabaseNotice />
      <AdminScopeBanner />
      {!hasProgram && (
        <div className="mb-4">
          <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. A gravação está bloqueada (fail-closed)." onRetry={() => window.location.reload()} />
        </div>
      )}
      <form onSubmit={handleSave}>
        <AdminCard
          title="Valores actuais"
        >
          <div className="space-y-4">
            <FormError message={error} />
            {!hasProgram && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Sem programa válido — os campos estão bloqueados até selecionar um programa.
              </p>
            )}
            {saved && (
              <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-300">
                Configurações guardadas com sucesso e registadas em auditoria.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome do sítio">
                <TextInput value={values.siteName} onChange={(e) => set('siteName', e.target.value)} required />
              </Field>
              <Field label="Slug da edição activa" hint="Ex.: premios-melhores-do-ano-portugal-2026">
                <TextInput value={values.activeCampaignSlug} onChange={(e) => set('activeCampaignSlug', e.target.value)} />
              </Field>
            </div>
            <Field label="Regras de votação (resumo público)">
              <TextArea value={values.votingRules} onChange={(e) => set('votingRules', e.target.value)} rows={2} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Slogan (tagline)">
                <TextInput value={values.tagline} onChange={(e) => set('tagline', e.target.value)} />
              </Field>
              <Field label="Texto do botão principal (CTA)">
                <TextInput value={values.primaryCta} onChange={(e) => set('primaryCta', e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle checked={values.maintenanceMode} onChange={(v) => set('maintenanceMode', v)} label="Modo de manutenção (sítio público)" />
              <Toggle checked={values.resultsVisible} onChange={(v) => set('resultsVisible', v)} label="Resultados visíveis (interruptor global legado)" />
            </div>
            <p className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[13px] leading-relaxed text-slate-400">
              FASE 4E — autoridade de publicação: <strong className="text-slate-200">campaigns.results_public</strong> (Admin → Campanhas, com confirmação e auditoria).
              Este interruptor global <strong className="text-slate-200">não publica sozinho</strong>: a página pública exige <code>results_public=true</code> na edição (fail-closed).
            </p>
          </div>
        </AdminCard>

        <AdminCard title="Votação & antifraude (Phase 2)" className="mt-4">
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-gold-500/25 bg-gold-500/5 p-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
            <p className="text-[13px] leading-relaxed text-slate-300">
              Segredos (<code>VOTE_HASH_SECRET</code>, <code>TURNSTILE_SECRET_KEY</code>, service role)
              configuram-se nos <strong>Edge Secrets</strong> do Supabase — nunca aqui nem no frontend.
              Esta secção guarda apenas flags públicas e limites.
            </p>
          </div>
          {!votingLoaded ? (
            <PageLoading label="A carregar definições de votação…" />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle checked={voting.votingEnabled} onChange={(v) => setV('votingEnabled', v)} label="Votação pública activa (cast-vote)" />
                <Toggle checked={voting.turnstileEnabled} onChange={(v) => setV('turnstileEnabled', v)} label="Exigir Cloudflare Turnstile" />
              </div>
              <Field
                label="Turnstile site key (pública)"
                hint="Chave pública do widget. O segredo (TURNSTILE_SECRET_KEY) fica nos Edge Secrets."
              >
                <TextInput
                  value={voting.turnstileSiteKey}
                  onChange={(e) => setV('turnstileSiteKey', e.target.value)}
                  placeholder="0x4AAAAAAA…"
                  inputMode="text"
                />
              </Field>
              {voting.turnstileEnabled && !voting.turnstileSiteKey.trim() && (
                <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-amber-200">
                  Turnstile activo sem site key: o widget não renderiza e a Edge Function rejeita
                  votos sem token válido. Preencha a site key ou desactive o Turnstile.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Janela rate-limit (s)" hint="60–3600">
                  <TextInput value={voting.rateWindow} onChange={(e) => setV('rateWindow', e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Tentativas / janela" hint="1–200 por ip_hash">
                  <TextInput value={voting.rateMaxAttempts} onChange={(e) => setV('rateMaxAttempts', e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Votos / 24h" hint="1–500 por ip_hash">
                  <TextInput value={voting.rateMaxVotes24h} onChange={(e) => setV('rateMaxVotes24h', e.target.value)} inputMode="numeric" />
                </Field>
              </div>
            </div>
          )}
          <div className="mt-5">
            <button
              type="submit"
              disabled={saving || !isSupabaseConfigured || !hasProgram}
              title={isSupabaseConfigured ? 'Guardar' : 'Disponível após configurar o Supabase'}
              className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'A guardar…' : 'Guardar configurações'}
            </button>
          </div>
        </AdminCard>
      </form>
    </div>
  );
}
