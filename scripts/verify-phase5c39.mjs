/**
 * FASE 5C.3.9 — Verificação LOCAL (SEM tocar no banco remoto).
 * Valida o complemento da votação independente por modalidade sem executar
 * SQL remotamente, sem db push, sem deploy, sem seeds.
 * Uso: node scripts/verify-phase5c39.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CAST_VOTE = 'F8D382B2F0B6FD2AFB4E742275AA4297266AFDE5A398B4B4258787027FE6115C';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(p) {
  return readFileSync(join(root, p), 'utf8');
}

/** Remove comentários -- e block comments para inspecção de código executável. */
function codeOf(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Remove comentários JS/TS (line + block) e strings simples para scan de segredos/escritas. */
function jsCodeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

// ---- 1. cast-vote intocável ----
const castVotePath = join(root, 'supabase/functions/cast-vote/index.ts');
const castVoteHash = createHash('sha256').update(readFileSync(castVotePath, 'utf8')).digest('hex').toUpperCase();
check('cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const castVoteEdge = read('supabase/functions/cast-vote/index.ts');
check('cast-vote sem referências a modalidades (intocável)', !/modality|modalidade|award_modalit/i.test(castVoteEdge));

// ---- 2. Migration 0015: fundação de voto por modalidade, sem seeds, sem tocar no principal ----
const migDir = join(root, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
check(
  'migrations 0001–0014 presentes',
  migs.length >= 15 && migs.slice(0, 14).every((f, i) => f.startsWith(String(i + 1).padStart(4, '0'))),
  migs.join(', '),
);
const m15path = join(migDir, '0015_phase5c39_modality_voting.sql');
check('migration 0015 existe', existsSync(m15path));
const sql15 = existsSync(m15path) ? readFileSync(m15path, 'utf8') : '';
const code15 = codeOf(sql15);
check('0015 transaccional (BEGIN … COMMIT únicos)', /^BEGIN;/m.test(code15) && /COMMIT;\s*$/.test(code15.trim()));
check('0015 cria modality_votes', /create table if not exists public\.modality_votes/i.test(code15));
check('0015 cria modality_vote_attempts', /create table if not exists public\.modality_vote_attempts/i.test(code15));
check('0015 cria get_admin_modality_tally', /create or replace function public\.get_admin_modality_tally/i.test(code15));
check('0015 UNIQUE anti-duplicado por modalidade', /modality_votes_unique_per_modality_uidx/i.test(code15));
check('0015 RPC exige is_admin()', /public\.is_admin\(\)/.test(code15));
check('0015 sem INSERT em votes', !/insert\s+into\s+public\.votes/i.test(code15));
check('0015 sem UPDATE/DELETE em votes', !/(update|delete\s+from)\s+public\.votes/i.test(code15));
check('0015 sem escrita em vote_attempts', !/(insert|update|delete)(\s+into|\s+from)?\s+public\.vote_attempts/i.test(code15));
check('0015 sem escrita em vote_adjustments', !/(insert|update|delete)(\s+into|\s+from)?\s+public\.vote_adjustments/i.test(code15));
check('0015 não redefine get_admin_tally/overview', !/(create|drop)\s+.*function\s+public\.get_admin_(tally|vote_overview|vote_timeline)/i.test(code15));
check('0015 não redefine get_published_results', !/create\s+.*function\s+public\.get_published_results/i.test(code15));
check('0015 sem seeds (países/programas/campanhas/modalidades/votos)', !/insert\s+into\s+public\.(countries|award_programs|campaigns|award_modalities|modality_votes|businesses)/i.test(code15));
check('0015 sem preencher award_distinctions', !/insert\s+into\s+public\.award_distinctions/i.test(code15));
check('0015 sem monetização (Stripe/preços)', !/\b(amount_cents|stripe_|price_cents|unit_price)\b/i.test(code15));

// ---- 3. Edge Function cast-modality-vote (local, sem deploy) ----
check('cast-modality-vote/index.ts existe', existsSync(join(root, 'supabase/functions/cast-modality-vote/index.ts')));
check('cast-modality-vote/deno.json existe', existsSync(join(root, 'supabase/functions/cast-modality-vote/deno.json')));
check('cast-modality-vote/README.md existe', existsSync(join(root, 'supabase/functions/cast-modality-vote/README.md')));
const edgeMod = read('supabase/functions/cast-modality-vote/index.ts');
const edgeModCode = jsCodeOf(edgeMod);
check('edge recebe campaign_entry_id + modality_id', /campaign_entry_id/.test(edgeMod) && /modality_id/.test(edgeMod));
check('edge resolve entry server-side', /from\("campaign_entries"\)/.test(edgeMod));
check('edge escreve SÓ em modality_votes/modality_vote_attempts',
  /from\("modality_votes"\)/.test(edgeMod) && /from\("modality_vote_attempts"\)/.test(edgeMod));
check('edge NUNCA escreve em votes/vote_attempts/vote_adjustments',
  !/from\("votes"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/from\("vote_attempts"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/vote_adjustments/i.test(edgeModCode));
check('edge NUNCA preenche award_distinctions', !/award_distinctions/i.test(edgeModCode));
check('edge valida modalidade activa + coerência categoria/programa',
  /modality_inactive|MODALITY_INACTIVE/.test(edgeMod) && /modality_category_mismatch|CATEGORY_MISMATCH/.test(edgeMod) && /program_mismatch|PROGRAM_MISMATCH/.test(edgeMod));
check('edge UNIQUE 23505 → already_voted (1 voto POR modalidade)', /23505/.test(edgeMod) && /already_voted/.test(edgeMod));
check('edge rate-limit separado (modality_*, nunca vote_attempts)', /modality_vote_attempts/.test(edgeMod) && /rate_limited/.test(edgeMod));

// ---- 4. Frontend público: segunda etapa opcional integrada ----
const categoryPage = read('src/pages/public/CategoryPage.tsx');
check('CategoryPage importa ModalityVoteStep + hooks 5C.3.9',
  categoryPage.includes('ModalityVoteStep') &&
  categoryPage.includes('useCategoryModalities') &&
  categoryPage.includes('useModalityVoting'));
check('CategoryPage só mostra destaques após voto principal (mainVoteRegistered)',
  /mainVoteRegistered/.test(categoryPage) && /showModalityStep/.test(categoryPage));
check('CategoryPage: voto principal intocado (usa useVoting + cast-vote)',
  categoryPage.includes('useVoting') && /VoteModal/.test(categoryPage));
const modalityStep = read('src/components/ModalityVoteStep.tsx');
check('ModalityVoteStep existe e lista só modalidades activas', /activeModalities/.test(modalityStep) && /\.active === true/.test(modalityStep));
check('ModalityVoteStep sem modalidades → null (etapa some, principal continua)',
  /if \(activeModalities\.length === 0\) return null/.test(modalityStep));
const modalityLib = read('src/lib/modalityVoting.ts');
check('lib/modalityVoting invoca cast-modality-vote', /functions\.invoke\(['"]cast-modality-vote['"]/.test(modalityLib));
const modalityLibCode = jsCodeOf(modalityLib);
check('lib/modalityVoting sem INSERT/UPDATE/DELETE directo em modality_*',
  !/\.from\(['"]modality_votes['"]\)\s*\.\s*(insert|update|delete|upsert)/i.test(modalityLibCode) &&
  !/\.from\(['"]modality_vote_attempts['"]\)\s*\.\s*(insert|update|delete|upsert)/i.test(modalityLibCode));
check('lib/modalityVoting sem segredos no frontend',
  !/VOTE_HASH_SECRET|TURNSTILE_SECRET_KEY|SERVICE_ROLE_KEY|service_role/i.test(modalityLibCode));
check('hook useCategoryModalities existe e filtra active + programa',
  existsSync(join(root, 'src/hooks/useCategoryModalities.ts')) &&
  /active/.test(read('src/hooks/useCategoryModalities.ts')) &&
  /resolveEffectiveProgram/.test(read('src/hooks/useCategoryModalities.ts')));
check('hook useModalityVoting existe (idle→confirming→submitting→done)',
  existsSync(join(root, 'src/hooks/useModalityVoting.ts')) &&
  /confirming/.test(read('src/hooks/useModalityVoting.ts')));
check('hook useAdminModalityTally existe e usa get_admin_modality_tally',
  existsSync(join(root, 'src/hooks/useAdminModalityTally.ts')) &&
  /get_admin_modality_tally/.test(read('src/hooks/useAdminModalityTally.ts')));
const tallyHookCode = jsCodeOf(read('src/hooks/useAdminModalityTally.ts'));
check('useAdminModalityTally nunca soma votes nem usa vote_adjustments',
  !/get_admin_tally[^_]|vote_adjustments|from\(['"]votes['"]\)/i.test(tallyHookCode));

// ---- 5. Admin: resultados por modalidade integrados, principal separado ----
const resultsAdmin = read('src/pages/admin/ResultsAdminPage.tsx');
check('ResultsAdmin usa useAdminModalityTally', resultsAdmin.includes('useAdminModalityTally'));
check('ResultsAdmin tem cartão de apuramento por modalidade', /Apuramento por modalidade/i.test(resultsAdmin));
check('ResultsAdmin mantém apuramento principal (get_admin_tally)', resultsAdmin.includes('useAdminTally'));
check('ResultsAdmin: modalidades sem ajustes (sem VoteAdjustmentModal por modalidade)',
  !/modality.*VoteAdjustmentModal|VoteAdjustmentModal.*modality/i.test(resultsAdmin));
check('types têm ModalityVote/ModalityVoteAttempt',
  read('src/types/database.ts').includes('ModalityVote') &&
  read('src/types/database.ts').includes('ModalityVoteAttempt'));

// ---- 6. Integridade eleitoral: ficheiros do voto principal intactos ----
for (const f of ['src/hooks/useVoting.ts', 'src/hooks/useVoteAdjustments.ts', 'src/hooks/usePublishedResults.ts']) {
  const p = join(root, f);
  if (existsSync(p)) {
    const c = readFileSync(p, 'utf8');
    check(`${f} sem referência a modalidades (electoral intacto)`, !/award_modalit|modality_vote|ModalityVote/i.test(c));
  }
}

// ---- 7. Config local das Edge Functions ----
let configToml = '';
try {
  configToml = read('supabase/config.toml');
} catch {
  configToml = '';
}
check(
  'supabase/config.toml declara cast-vote pública (verify_jwt=false)',
  /\[functions\.cast-vote\]/.test(configToml) && /verify_jwt\s*=\s*false/.test(configToml),
);
check(
  'supabase/config.toml declara cast-modality-vote local (verify_jwt=false)',
  /\[functions\.cast-modality-vote\]/.test(configToml),
  'sem deploy — só serve local',
);

if (failures > 0) {
  console.error(`\n5C.3.9 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.9 VERIFY: tudo válido (local, sem banco remoto alterado).');
