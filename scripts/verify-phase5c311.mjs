/**
 * FASE 5C.3.11 — Verificação LOCAL (SEM tocar no banco remoto).
 * Fluxo operacional das distinções: mérito × comercial separados,
 * pipeline Pendente→Contactado→Aceite→Confirmado / Recusado / Cancelado,
 * ações rápidas, notas, filtros, cards, regra de recusa sem transferência.
 * Sem db push, sem deploy, sem seeds, sem git.
 * Uso: node scripts/verify-phase5c311.mjs
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

/** Remove comentários JS/TS para scan de código executável. */
function jsCodeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

// ---- 21. cast-vote intacto ----
const castVoteHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('21. cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const castVoteEdge = read('supabase/functions/cast-vote/index.ts');
check('21. cast-vote sem referências a modalidades/distinções', !/modality|modalidade|award_distinction|distincao|distinção/i.test(castVoteEdge));

// ---- 22. cast-modality-vote intacto ----
const edgeMod = read('supabase/functions/cast-modality-vote/index.ts');
const edgeModCode = jsCodeOf(edgeMod);
check('22. cast-modality-vote existe e escreve SÓ em modality_votes/modality_vote_attempts',
  /from\("modality_votes"\)/.test(edgeMod) && /from\("modality_vote_attempts"\)/.test(edgeMod));
check('22. edge NUNCA escreve em votes/vote_attempts/vote_adjustments',
  !/from\("votes"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/from\("vote_attempts"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/vote_adjustments/i.test(edgeModCode));
check('22. edge NUNCA preenche award_distinctions', !/award_distinctions/i.test(edgeModCode));

// ---- 27. nenhuma migration 0016 / remota ----
const migDir = join(root, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
check('27. migrations 0001–0015 presentes, sem 0016 (estrutura existente reutilizada)',
  migs.length === 15 && migs.slice(0, 15).every((f, i) => f.startsWith(String(i + 1).padStart(4, '0'))) && !migs.some((f) => f.startsWith('0016')),
  migs.join(', '));

// ---- 28. nenhuma Edge Function nova deployada ----
const fnDir = join(root, 'supabase/functions');
const fns = readdirSync(fnDir);
check('28. nenhuma Edge Function nova (só cast-vote + cast-modality-vote)',
  fns.includes('cast-vote') && fns.includes('cast-modality-vote') && fns.length === 2, fns.join(', '));

// ---- 1/2/3. página + provider + campanha ----
check('1. página Distinções existe', exists('src/pages/admin/DistinctionsAdminPage.tsx'));
const dist = exists('src/pages/admin/DistinctionsAdminPage.tsx') ? read('src/pages/admin/DistinctionsAdminPage.tsx') : '';
check('2. usa AdminProgramProvider/useAdminProgram', /useAdminProgram/.test(dist));
check('2. usa AdminScopeBanner (fail-closed visual)', /AdminScopeBanner/.test(dist));
check('3. depende de selectedCampaignId', /selectedCampaignId/.test(dist) && /selectedProgramId/.test(dist));
check('3. fail-closed sem programa/edição', /fail-closed/i.test(dist) && /Sem programa válido/.test(dist) && /Sem edição válida/.test(dist) && /requireCampaign/.test(dist));

// ---- 4/5/6/7. filtros ----
check('4. filtros por cidade/categoria/modalidade', /cityFilter/.test(dist) && /categoryFilter/.test(dist) && /modalityFilter/.test(dist));
check('5. filtro award_status', /awardFilter/.test(dist) && /AWARD_STATUSES|award_status/.test(dist));
check('6. filtro commercial_status', /commercialFilter/.test(dist) && /COMMERCIAL_STATUSES|commercial_status/.test(dist));
check('7. pesquisa por empresa', /Pesquisa por empresa/.test(dist) && /businessById\.get/.test(dist));
check('4-7. dropdowns isolados por programa', /useScopedCities/.test(dist) && /useScopedCategories/.test(dist) && /useScopedModalities/.test(dist));

// ---- B. colunas operacionais separadas ----
for (const col of ['Empresa', 'Cidade', 'Categoria', 'Modalidade', 'Posição', 'Origem', 'Mérito', 'Estado comercial', 'Notas', 'Última atualização']) {
  check(`B. coluna "${col}" presente`, dist.includes(col), col);
}
check('B. mérito e comercial nunca fundidos (badges + controlos separados)',
  /award_status/.test(dist) && /commercial_status/.test(dist) && /pillClass\('award'/.test(dist) && /pillClass\('commercial'/.test(dist));

// ---- C. mérito ----
const lib = exists('src/lib/distinctions.ts') ? read('src/lib/distinctions.ts') : '';
check('C. award_status eligible|selected|winner|confirmed|cancelled', /'eligible'/.test(lib) && /'selected'/.test(lib) && /'winner'/.test(lib) && /'confirmed'/.test(lib) && /'cancelled'/.test(lib));
check('C. alteração de mérito só via updateAwardStatus auditada', /updateAwardStatus/.test(dist) && /award_distinction\.award_status_changed/.test(lib));

// ---- D. pipeline comercial ----
check('D. commercial_status pending|contacted|accepted|declined|confirmed|cancelled',
  /'pending'/.test(lib) && /'contacted'/.test(lib) && /'accepted'/.test(lib) && /'declined'/.test(lib) && /'confirmed'/.test(lib) && /'cancelled'/.test(lib));
check('D. pipeline Pendente→Contactado→Aceite→Confirmado documentado',
  /Pendente.*Contactado.*Aceite.*Confirmado/.test(dist) && /COMMERCIAL_FLOW|nextCommercialTransitions/.test(lib + dist));

// ---- 8. cards operacionais ----
check('8. cards Total/Pendentes/Contactadas/Aceites/Recusadas/Confirmadas',
  /Total de distinções/.test(dist) && /Pendentes de contacto/.test(dist) && /Contactadas/.test(dist) && /Aceites/.test(dist) && /Recusadas/.test(dist) && /Confirmadas/.test(dist));
check('8. contagens derivadas de commercial_status (não de votos)',
  /commercial_status === 'pending'/.test(dist) && /commercial_status === 'declined'/.test(dist) && !/cards.*total_votes|total_votes.*cards/i.test(dist));

// ---- 9. ações rápidas ----
for (const a of ['Marcar como contactado', 'Marcar como aceite', 'Marcar como recusado', 'Confirmar', 'Cancelar']) {
  check(`9. ação rápida "${a}"`, (lib + dist).includes(a), a);
}
check('9. ações usam updateCommercialStatus (arquitetura existente)', /updateCommercialStatus/.test(dist) && /handleCommercialChange/.test(dist));

// ---- 10/11/12. regra central ----
const libCode = jsCodeOf(lib);
const _updStart = lib.indexOf('export async function updateCommercialStatus');
const _updRest = lib.slice(_updStart);
const _nextExport = _updRest.indexOf('\nexport ', 10);
const updComm = _nextExport > 0 ? _updRest.slice(0, _nextExport) : _updRest;
check('10. commercial_status NÃO altera award_status (só update commercial_status)',
  /update\(\{\s*commercial_status:\s*next/.test(updComm) && !/award_status/.test(updComm));
check('11. declined NÃO cria nova distinção (sem insert em updateCommercialStatus)', !/\.insert\(/.test(updComm));
check('12. declined NÃO transfere posição (sem update de position/ranking)',
  !/position/.test(updComm) && /Recusou a distinção/.test(dist) && /mérito preservado|sem transferência/i.test(dist));

// ---- 13. notas ----
check('13. notas administrativas suportadas (updateDistinctionNotes + modal, sem exposição pública)',
  /updateDistinctionNotes/.test(lib) && /notesTarget/.test(dist) && /sem exposição pública|administrativas/i.test(dist));

// ---- 14. auditoria ----
check('14. eventos award_distinction.created/award_status_changed/commercial_status_changed/notes_updated',
  /award_distinction\.created/.test(lib) && /award_distinction\.award_status_changed/.test(lib) && /award_distinction\.commercial_status_changed/.test(lib) && /award_distinction\.notes_updated/.test(lib));

// ---- 15/J. ResultsAdmin intacto + navegação ----
const results = read('src/pages/admin/ResultsAdminPage.tsx');
check('15/J. ResultsAdmin mantém get_admin_tally + ranking original', /get_admin_tally|useAdminTally/.test(results) && /position/.test(results));
check('J. Resultado → Criar/Gerir distinção → Ver distinção', /Criar distinção/.test(results) && /Gerir distinção/.test(results) && /Ver distinção/.test(results) && /admin\/distincoes\?/.test(results));
check('J. sem VoteAdjustmentModal por modalidade (principal intacto)',
  !/modality.*VoteAdjustmentModal|VoteAdjustmentModal.*modality/i.test(results));

// ---- K. Modalidades ----
const mod = read('src/pages/admin/ModalitiesAdminPage.tsx');
check('K. Modalidades mantém "Ver distinções"', /Ver distinções/.test(mod) && /admin\/distincoes/.test(mod));
check('K. indicação X distinções / Y confirmadas / Z recusadas', /distinç/.test(mod) && /confirmada/.test(mod) && /recusada/.test(mod));

// ---- 16-20. proteções eleitorais ----
const frontendFiles = ['src/lib/distinctions.ts', 'src/pages/admin/DistinctionsAdminPage.tsx', 'src/pages/admin/ResultsAdminPage.tsx', 'src/pages/admin/ModalitiesAdminPage.tsx'];
const frontendAll = frontendFiles.map((f) => { try { return read(f); } catch { return ''; } }).join('\n');
const frontendCode = jsCodeOf(frontendAll);
for (const t of ['votes', 'vote_attempts', 'vote_adjustments', 'modality_votes', 'modality_vote_attempts']) {
  check(`proteção: lib+páginas NUNCA escrevem em ${t}`,
    !new RegExp(`from\\(["']${t}["']\\)\\s*\\)\\s*\\.\\s*(insert|update|delete|upsert)`, 'i').test(frontendCode) &&
    !new RegExp(`from\\(["']${t}["']\\)\\s*\\.\\s*(insert|update|delete|upsert)`, 'i').test(frontendCode));
}
check('16-20. posição/votos só via get_admin_modality_tally (nunca copiados)', /get_admin_modality_tally/.test(dist) && !/total_votes/.test(libCode));

// ---- 23/24/25/26. guardas negativos ----
check('23. sem monetização (Stripe/preço/pagamento/fatura/checkout)', !/\bstripe\b|amount_cents|price_cents|unit_price|pagamento|fatura|checkout|comiss/i.test(frontendCode));
check('24. sem seeds', !/insert\s+into\s+public\.(countries|award_programs|campaigns|award_modalities|modality_votes|businesses)/i.test(frontendCode) && !/\.from\(['"](countries|award_programs|campaigns)['"]\)\s*\.\s*insert/i.test(frontendCode));
check('25. sem 2027', !/2027/.test(frontendCode));
check('26. sem novo país/programa', !/award_programs["']?\)\s*\.\s*(insert|update)/i.test(frontendCode));

if (failures > 0) {
  console.error(`\n5C.3.11 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.11 VERIFY: tudo válido (local, sem banco remoto alterado).');
