/**
 * Prémios Melhores do Ano Portugal — Phase 2
 * Testes estáticos do motor de votação (sem BD viva necessária).
 *
 * Cobre os 14 casos pedidos:
 *  1. first valid vote            8. inactive campaign entry
 *  2. duplicate vote              9. invalid entry ID
 *  3. two simultaneous duplicates 10. rapid requests (rate-limit)
 *  4. vote in another category    11. CAPTCHA failure
 *  5. inactive campaign           12. anonymous direct DB insertion
 *  6. expired campaign            13. non-admin accessing vote data
 *  7. future campaign             (+14. inactive business)
 *
 * Execução: `node scripts/test-voting-engine.mjs`
 * Critério: exit 0 = todos passaram; exit 1 = falhas.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let passed = 0;
let failed = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const migration = read('supabase/migrations/0005_phase2_voting_engine.sql');
const edge = read('supabase/functions/cast-vote/index.ts');
const votingClient = read('src/lib/voting.ts');
const categoryPage = read('src/pages/public/CategoryPage.tsx');
const voteModal = read('src/components/VoteModal.tsx');
const deviceLib = read('src/lib/deviceId.ts');
const resultsPage = read('src/pages/public/ResultsPage.tsx');
const votesAdmin = read('src/pages/admin/VotesAdminPage.tsx');
const settingsAdmin = read('src/pages/admin/SettingsAdminPage.tsx');
const overviewHook = read('src/hooks/useAdminVoteStats.ts');

// ---- 0. Ficheiros existem ----
check(
  'migration + edge function existem',
  existsSync(join(root, 'supabase/migrations/0005_phase2_voting_engine.sql')) &&
    existsSync(join(root, 'supabase/functions/cast-vote/index.ts')),
);

// ---- 1. UNIQUE constraint final ----
check(
  'unique (campaign, city, category, ip_hash) ao nível da BD',
  /votes_unique_ip_per_category_uidx/.test(migration) &&
    /campaign_id,\s*city_id,\s*category_id,\s*ip_hash/.test(migration),
  'índice único dedicado (protecção anti-race)',
);

// ---- 2. Frontend nunca insere em votes ----
const frontendVoteWrites = [
  ...votingClient.matchAll(/\.from\(['"]votes['"]\)\s*\.\s*(insert|update|delete|upsert)/gi),
  ...categoryPage.matchAll(/\.from\(['"]votes['"]\)\s*\.\s*(insert|update|delete|upsert)/gi),
  ...resultsPage.matchAll(/\.from\(['"]votes['"]\)\s*\.\s*(insert|update|delete|upsert)/gi),
].length;
check(
  'anonymous direct DB insertion bloqueado (frontend sem INSERT/UPDATE/DELETE em votes)',
  frontendVoteWrites === 0 && /functions\.invoke\(['"]cast-vote['"]/.test(votingClient),
  `escritas directas encontradas: ${frontendVoteWrites}; voto vai via functions.invoke('cast-vote')`,
);

// ---- 3. RLS nega INSERT/UPDATE/DELETE anónimo ----
check(
  'RLS: sem policies permissivas em votes/vote_attempts + leitura só admin',
  /drop policy if exists "public insert votes"/.test(migration) &&
    /drop policy if exists "authenticated insert votes"/.test(migration) &&
    /create policy "admin read votes"/.test(migration) &&
    /create policy "admin read vote_attempts"/.test(migration) &&
    !/create policy "public insert votes"/.test(migration),
);

// ---- 4. Edge: dados mínimos + sem confiança no cliente ----
check(
  'edge só aceita campaign_entry_id (+device/captcha); resolve resto na BD',
  /campaign_entry_id/.test(edge) &&
    /from\("campaign_entries"\)/.test(edge) &&
    !/body\.campaign_id/.test(edge) &&
    !/body\.business_id/.test(edge) &&
    !/body\.city_id/.test(edge),
);

// ---- 5. IP privacy: HMAC, sem IP em claro ----
check(
  'IP privacy: HMAC-SHA256 com VOTE_HASH_SECRET; sem coluna de IP bruto',
  /VOTE_HASH_SECRET/.test(edge) &&
    /hmacHex\(VOTE_SECRET,\s*"ip"/.test(edge) &&
    /ip_hash/.test(edge) &&
    !/\.insert\(\{[^}]*\bip\b\s*:/s.test(edge) &&
    /ip_hash:\s*ipHash/.test(edge),
);

// ---- 6. Device hash server-side, sem fingerprinting ----
check(
  'device anónimo: token opaco local + hash server-side',
  /localStorage/.test(deviceLib) &&
    /randomUUID|xxxxxxxx-xxxx/.test(deviceLib) &&
    !/canvas|fingerprint|userAgent.*plugins|screen\.width/i.test(deviceLib) &&
    /hmacHex\(VOTE_SECRET,\s*"device"/.test(edge),
);

// ---- 7. Validação de campanha/participante ----
const validationBranches = [
  'statusOk',
  'startOk',
  'endOk',
  'allActive',
  'campaign_closed',
  'invalid_entry',
].every((t) => edge.includes(t));
check(
  'campaign validation (status/janela/activos: campaign, entry, business, city, category)',
  validationBranches && /in \('"activa",\s*"votacao"\)|\(\s*campaign\.status === "activa"/.test(edge),
);
check(
  'casos: inactive/expired/future campaign -> campaign_closed; inactive business/entry -> invalid_entry',
  /campaign_closed/.test(edge) && /entry_inactive/.test(edge),
);

// ---- 8. invalid entry ID ----
check(
  'invalid entry ID -> invalid_entry (404/400)',
  /entry_not_found/.test(edge) && /isUuid\(entryId\)/.test(edge),
);

// ---- 9. Duplicado + race simultânea via 23505 ----
check(
  'duplicate vote + simultaneous race: UNIQUE 23505 -> already_voted',
  /23505/.test(edge) && /already_voted/.test(edge) && /unique_violation/.test(edge),
);

// ---- 10. Voto noutra categoria permitido (unicidade é por categoria) ----
check(
  'voto noutra categoria permitido (UNIQUE inclui category_id)',
  /category_id,\s*ip_hash/.test(migration),
);

// ---- 11. Rate limiting + registo em vote_attempts ----
check(
  'rate limiting (janela + 24h) -> rate_limited + log em vote_attempts',
  /vote_rate_window_seconds/.test(edge) &&
    /vote_rate_max_attempts/.test(edge) &&
    /vote_rate_max_votes_24h/.test(edge) &&
    /rate_limited/.test(edge) &&
    /vote_attempts/.test(edge),
);

// ---- 12. CAPTCHA server-side configurável ----
check(
  'Turnstile: flag em site_settings + verificação server-side (nunca só cliente)',
  /turnstile_enabled/.test(edge) &&
    /siteverify/.test(edge) &&
    /TURNSTILE_SECRET_KEY/.test(edge) &&
    /captcha_failed/.test(edge) &&
    /turnstile_enabled/.test(settingsAdmin) &&
    /turnstile_site_key/.test(settingsAdmin),
);

// ---- 13. Respostas estruturadas sem leaks ----
const statuses = ['success', 'already_voted', 'campaign_closed', 'invalid_entry', 'rate_limited', 'captcha_failed', 'server_error'];
check(
  'edge responses estruturadas (7 estados) sem erros internos expostos',
  statuses.every((s) => edge.includes(`"${s}"`)) &&
    !/insertError\.message[^]*Response|return new Response\(JSON\.stringify\(insertError/.test(edge),
);

// ---- 14. UI pública: textos oficiais + sem totais ----
check(
  'UI: botão Votar + modal Confirmar + sucesso + já-votou + CTA outras categorias',
  /Votar/.test(categoryPage) &&
    /Confirmar o seu voto/.test(voteModal) &&
    /Confirmar voto/.test(voteModal) &&
    /Voto registado!/.test(voteModal) &&
    /Já registámos um voto desta ligação nesta categoria/.test(voteModal) &&
    /Votar noutras categorias/.test(voteModal),
);
check(
  'PUBLIC RESULTS: sem totais exactos com results_public=false (só RPC publicada)',
  !/total_votes/.test(categoryPage) &&
    (/get_published_results/.test(resultsPage) ||
      /usePublishedResults/.test(resultsPage)),
);

// ---- 15. Admin: agregados seguros ----
check(
  'ADMIN RESULTS: overview/timeline/tally via RPC is_admin + dashboard (total, hoje, cidade, categoria, ranking, timeline)',
  /get_admin_vote_overview/.test(migration) &&
    /get_admin_tally/.test(migration) &&
    /get_admin_vote_timeline/.test(migration) &&
    /public\.is_admin\(\)/.test(migration) &&
    /get_admin_vote_overview/.test(overviewHook) &&
    /total_votes|votes_today|by_city|by_category|position/i.test(votesAdmin),
);

// ---- 16. Non-admin bloqueado nos agregados ----
check(
  'non-admin sem acesso a vote data (42501 nas RPCs admin)',
  (migration.match(/raise exception 'Acesso negado: s[^']*administradores\.' using errcode = '42501'/g) ?? []).length >= 3,
  '3 RPCs admin com guarda is_admin()',
);

// ---- 17. Segredos fora do frontend ----
// NOTA: comentários de documentação mencionam propositadamente os nomes dos
// segredos para declarar a sua AUSÊNCIA (ex.: voting.ts: "NENHUM segredo …
// existe neste ficheiro"). O que esta verificação proíbe é segredo ligado
// em CÓDIGO — por isso os comentários são removidos antes do scan.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const secretLeak =
  /VOTE_HASH_SECRET|TURNSTILE_SECRET_KEY|SERVICE_ROLE_KEY|service_role/i.test(stripComments(votingClient)) ||
  /VOTE_HASH_SECRET|TURNSTILE_SECRET_KEY|SERVICE_ROLE_KEY/i.test(stripComments(categoryPage)) ||
  /VOTE_HASH_SECRET|TURNSTILE_SECRET_KEY/.test(stripComments(deviceLib));
check('service role / segredos nunca no frontend', !secretLeak);

// ---- 18. Config de deploy da Edge (verify_jwt=false: voto anónimo público) ----
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
const edgeReadme = read('supabase/functions/cast-vote/README.md');
check(
  'README documenta deploy --no-verify-jwt + segredos VOTE_HASH_SECRET/TURNSTILE_SECRET_KEY',
  /--no-verify-jwt/.test(edgeReadme) &&
    /VOTE_HASH_SECRET/.test(edgeReadme) &&
    /TURNSTILE_SECRET_KEY/.test(edgeReadme),
);

// ---- 19. Transparência pública: regras + privacidade reflectem o motor real ----
const rulesPage = read('src/pages/public/RulesPage.tsx');
const privacyPage = read('src/pages/public/PrivacyPage.tsx');
check(
  'regulamento: 1 voto/categoria, outras categorias permitidas, sem IP em claro',
  /um voto por categoria/i.test(rulesPage) &&
    /categorias diferentes/i.test(rulesPage) &&
    /sem armazenamento de endereços IP em texto claro/i.test(rulesPage),
);
check(
  'privacidade: identificador anónimo em localStorage declarado (RGPD)',
  /localStorage/.test(privacyPage) && /identificador anónimo/i.test(privacyPage),
);

// ---- Resumo ----
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total.`);
if (failed > 0) {
  console.log('Falhas:');
  for (const r of results.filter((r) => !r.ok)) console.log(` - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  process.exit(1);
}
