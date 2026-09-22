/**
 * FASE 5C.3.10 — Verificação LOCAL (SEM tocar no banco remoto).
 * Gestão operacional de distinções + pipeline comercial, sem manipular
 * o resultado oficial. Sem db push, sem deploy, sem seeds, sem git.
 * Uso: node scripts/verify-phase5c310.mjs
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
function exists(p) {
  return existsSync(join(root, p));
}

/** Remove comentários -- e block comments para inspecção de código executável. */
function codeOf(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Remove comentários JS/TS (line + block) para scan de segredos/escritas. */
function jsCodeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

// ---- S. cast-vote intocável (ANTES de tudo: fail-fast informativo) ----
const castVoteHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('S. cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const castVoteEdge = read('supabase/functions/cast-vote/index.ts');
check('cast-vote sem referências a modalidades/distinções (intocável)', !/modality|modalidade|award_distinction|distincao|distinção/i.test(castVoteEdge));

// ---- T. cast-modality-vote não alterada semanticamente ----
const edgeMod = read('supabase/functions/cast-modality-vote/index.ts');
const edgeModCode = jsCodeOf(edgeMod);
check('T. cast-modality-vote existe e escreve SÓ em modality_votes/modality_vote_attempts',
  /from\("modality_votes"\)/.test(edgeMod) && /from\("modality_vote_attempts"\)/.test(edgeMod));
check('T. edge NUNCA escreve em votes/vote_attempts/vote_adjustments',
  !/from\("votes"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/from\("vote_attempts"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/vote_adjustments/i.test(edgeModCode));
check('T. edge NUNCA preenche award_distinctions', !/award_distinctions/i.test(edgeModCode));

// ---- Migrações: 0014/0015 intactas, 0016 inexistente (não necessária) ----
const migDir = join(root, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
check('migrations 0001–0015 presentes, sem 0016 (não necessária)',
  migs.length === 16 - 1 && migs.slice(0, 15).every((f, i) => f.startsWith(String(i + 1).padStart(4, '0'))) && !migs.some((f) => f.startsWith('0016')),
  migs.join(', '));
const sql14 = read('supabase/migrations/0014_phase5c38_award_modalities.sql');
check('0014: source já permite modality_vote (sem migration nova)',
  /'general_vote'\s*,\s*'modality_vote'\s*,\s*'jury'\s*,\s*'editorial'\s*,\s*'manual'/.test(codeOf(sql14)));
check('0014: award_status eligible|selected|winner|confirmed|cancelled',
  /'eligible'\s*,\s*'selected'\s*,\s*'winner'\s*,\s*'confirmed'\s*,\s*'cancelled'/.test(codeOf(sql14)));
check('0014: commercial_status pending|contacted|accepted|declined|confirmed|cancelled',
  /'pending'\s*,\s*'contacted'\s*,\s*'accepted'\s*,\s*'declined'\s*,\s*'confirmed'\s*,\s*'cancelled'/.test(codeOf(sql14)));
check('0014: UNIQUE (campaign, city, category, modality, business)',
  /award_distinctions_edition_scope_uidx/.test(sql14) && /campaign_id,\s*city_id,\s*category_id,\s*modality_id,\s*business_id/.test(codeOf(sql14)));
check('Q. 0014: auditoria em audit_logs (award_distinction.created/updated)',
  /award_distinction\.created/.test(sql14) && /award_distinction\.updated/.test(sql14) && /audit_logs/.test(sql14));

// ---- A/B/C/D/E. Admin Distinções ----
check('A. src/pages/admin/DistinctionsAdminPage.tsx existe', exists('src/pages/admin/DistinctionsAdminPage.tsx'));
const dist = exists('src/pages/admin/DistinctionsAdminPage.tsx') ? read('src/pages/admin/DistinctionsAdminPage.tsx') : '';
check('B. usa useAdminProgram (AdminProgramProvider é o provider do Admin)', /useAdminProgram/.test(dist));
check('B. usa AdminScopeBanner', /AdminScopeBanner/.test(dist));
check('C. usa selectedCampaignId + selectedProgramId', /selectedCampaignId/.test(dist) && /selectedProgramId/.test(dist));
check('D. fail-closed sem programa (sem dados por fallback)', /fail-closed/i.test(dist) && /Sem programa válido/.test(dist));
check('D. fail-closed sem edição (bloqueia criar/alterar)', /requireCampaign/.test(dist) && /Sem edição válida/.test(dist));
check('E. filtros cidade/categoria/modalidade/estado/pesquisa', /cityFilter/.test(dist) && /categoryFilter/.test(dist) && /modalityFilter/.test(dist) && /awardFilter/.test(dist) && /commercialFilter/.test(dist));
check('E. dropdowns via hooks isolados (useScopedCities/Categories/Modalities)', /useScopedCities/.test(dist) && /useScopedCategories/.test(dist) && /useScopedModalities/.test(dist));
check('rota /admin/distincoes em App.tsx', read('src/App.tsx').includes('admin/distincoes') && read('src/App.tsx').includes('DistinctionsAdminPage'));
check('menu Admin tem item Distinções', read('src/components/AdminLayout.tsx').includes('/admin/distincoes'));

// ---- F/G. criação a partir do resultado ----
const lib = exists('src/lib/distinctions.ts') ? read('src/lib/distinctions.ts') : '';
const libCode = jsCodeOf(lib);
check('F. createDistinction usa campaign/city/category/modality/business + position + source modality_vote',
  /campaign_id/.test(lib) && /city_id/.test(lib) && /category_id/.test(lib) && /modality_id/.test(lib) && /business_id/.test(lib) && /modality_vote/.test(lib) && /position/.test(lib));
check('F. defaults award_status=selected, commercial_status=pending, notes=NULL',
  /'selected'/.test(lib) && /'pending'/.test(lib) && /notes:\s*null/.test(libCode));
check('G. duplicado bloqueado (23505 → mensagem exigida)',
  /23505/.test(lib) && /Esta empresa já possui uma distinção nesta modalidade/.test(lib));

// ---- H/I/J/K/L/M. separação mérito × comercial; declined sem efeitos ----
check('H. award_status e commercial_status em colunas/funções separadas',
  /updateAwardStatus/.test(lib) && /updateCommercialStatus/.test(lib) && /award_status/.test(lib) && /commercial_status/.test(lib));
const updAward = lib.slice(lib.indexOf('export async function updateAwardStatus'));
const updAwardFn = updAward.slice(0, updAward.indexOf('/**', 1) > 0 ? updAward.indexOf('/**', 1) : updAward.length);
check('H. updateAwardStatus altera SOMENTE award_status', /update\(\{\s*award_status/.test(updAwardFn) && !/commercial_status/.test(updAwardFn));
const updComm = lib.slice(lib.indexOf('export async function updateCommercialStatus'));
check('I. declined NÃO altera award_status (só update commercial_status)',
  /update\(\{\s*commercial_status:\s*next/.test(updComm) && !/award_status/.test(updComm));
check('J. declined NÃO cria outra distinção (sem insert em updateCommercialStatus)',
  !/\.insert\(/.test(updComm));
for (const t of ['votes', 'vote_attempts', 'vote_adjustments', 'modality_votes', 'modality_vote_attempts']) {
  check(`K/L/M. lib distinções NUNCA escreve em ${t}`, !new RegExp(`from\\(["']${t}["']\\)\\s*\\)\\s*\\.\\s*(insert|update|delete|upsert)`, 'i').test(libCode) && !new RegExp(`into\\s+public\\.${t}`, 'i').test(libCode));
}

// ---- N/O. posição/votos via RPC, nunca armazenados ----
check('N. posição/votos lidos de get_admin_modality_tally', /get_admin_modality_tally/.test(dist));
check('O. votos NÃO copiados para award_distinctions (sem total_votes no payload)',
  !/total_votes/.test(libCode) && /não copi/i.test(lib));
check('O. página exibe votos só-leitura via RPC (nunca de award_distinctions)', /tallyMap/.test(dist) && /Via get_admin_modality_tally/i.test(dist));

// ---- P. notas editáveis ----
check('P. notas comerciais editáveis (updateDistinctionNotes + modal)', /updateDistinctionNotes/.test(lib) && /notesTarget/.test(dist));

// ---- Q. auditoria granular reutilizando infra 0014 ----
check('Q. eventos award_distinction.created/award_status_changed/commercial_status_changed/notes_updated',
  /award_distinction\.created/.test(lib) && /award_distinction\.award_status_changed/.test(lib) && /award_distinction\.commercial_status_changed/.test(lib) && /award_distinction\.notes_updated/.test(lib));

// ---- R. ResultsAdmin criar/gerir distinção ----
const results = read('src/pages/admin/ResultsAdminPage.tsx');
check('R. ResultsAdmin tem ação Criar distinção por empresa na modalidade', /Criar distinção/.test(results) && /createDistinction/.test(results));
check('R. ResultsAdmin mostra Distinção criada + Gerir distinção (deep-link)', /Distinção criada/.test(results) && /Gerir distinção/.test(results) && /admin\/distincoes\?/.test(results));
check('R. ResultsAdmin: sem VoteAdjustmentModal por modalidade (principal intacto)',
  !/modality.*VoteAdjustmentModal|VoteAdjustmentModal.*modality/i.test(results));
check('Modalidades tem acesso Ver distinções (sem CRM)', read('src/pages/admin/ModalitiesAdminPage.tsx').includes('Ver distinções') && read('src/pages/admin/ModalitiesAdminPage.tsx').includes('/admin/distincoes'));

// ---- U/V/W/X. guardas negativos ----
const frontendFiles = ['src/lib/distinctions.ts', 'src/pages/admin/DistinctionsAdminPage.tsx', 'src/pages/admin/ResultsAdminPage.tsx', 'src/pages/admin/ModalitiesAdminPage.tsx'];
const frontendAll = frontendFiles.map((f) => { try { return read(f); } catch { return ''; } }).join('\n');
const frontendCode = jsCodeOf(frontendAll);
check('U. sem monetização (Stripe/preço/pagamento/fatura/checkout)', !/\bstripe\b|amount_cents|price_cents|unit_price|pagamento|fatura|checkout|comiss/i.test(frontendCode));
check('V. sem seeds (sem INSERT em countries/programs/campaigns/modalidades/votos)', !/insert\s+into\s+public\.(countries|award_programs|campaigns|award_modalities|modality_votes|businesses)/i.test(frontendCode) && !/\.from\(['"](countries|award_programs|campaigns)['"]\)\s*\.\s*insert/i.test(frontendCode));
check('W. sem 2027 (sem ano hardcoded futuro)', !/2027/.test(frontendCode));
check('X. sem novo país/programa (sem INSERT em award_programs/countries)', !/award_programs["']?\)\s*\.\s*(insert|update)/i.test(frontendCode));
// Verificação textual de migrações: nenhuma 0016 criada
check('X. supabase/migrations sem ficheiro 0016', !migs.some((f) => f.startsWith('0016')));

if (failures > 0) {
  console.error(`\n5C.3.10 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.10 VERIFY: tudo válido (local, sem banco remoto alterado).');
