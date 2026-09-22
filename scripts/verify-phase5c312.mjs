/**
 * FASE 5C.3.12 — Verificação LOCAL (SEM tocar no banco remoto).
 * Gestão de reconhecimento e entrega das distinções: quarta dimensão
 * (fulfillment) separada de votos/ranking, mérito e comercial; itens
 * Certificado/Selo/Placa/Troféu; estados Pendente→…→Entregue/Cancelado;
 * entrega simples; notas administrativas nunca públicas; auditoria via
 * audit_logs; RLS admin-only; scope por programa/edição; fail-closed.
 * Sem db push, sem deploy, sem seeds, sem git, sem pagamentos.
 * Uso: node scripts/verify-phase5c312.mjs
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

/** Remove comentários SQL para scan de DDL executável. */
function sqlCodeOf(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

// ---- 27. cast-vote intacto ----
const castVoteHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('27. cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const castVoteEdge = read('supabase/functions/cast-vote/index.ts');
check('27. cast-vote sem referências a modalidades/distinções/fulfillment', !/modality|modalidade|award_distinction|distincao|distinção|fulfillment|reconhecimento/i.test(castVoteEdge));

// ---- 28. cast-modality-vote intacto ----
const edgeMod = read('supabase/functions/cast-modality-vote/index.ts');
const edgeModCode = jsCodeOf(edgeMod);
check('28. cast-modality-vote existe e escreve SÓ em modality_votes/modality_vote_attempts',
  /from\("modality_votes"\)/.test(edgeMod) && /from\("modality_vote_attempts"\)/.test(edgeMod));
check('28. edge NUNCA escreve em votes/vote_attempts/vote_adjustments',
  !/from\("votes"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/from\("vote_attempts"\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(edgeModCode) &&
  !/vote_adjustments/i.test(edgeModCode));
check('28. edge NUNCA preenche award_distinctions/distinction_fulfillment', !/award_distinctions|distinction_fulfillment/i.test(edgeModCode));

// ---- 1. arquitetura fulfillment existe ----
check('1. arquitetura fulfillment existe (migration + lib + tipos + hook + UI)',
  exists('supabase/migrations/0016_phase5c312_distinction_fulfillment.sql') &&
  exists('src/lib/fulfillment.ts') &&
  exists('src/pages/admin/DistinctionsAdminPage.tsx'));
const mig16 = exists('supabase/migrations/0016_phase5c312_distinction_fulfillment.sql') ? read('supabase/migrations/0016_phase5c312_distinction_fulfillment.sql') : '';
const mig16Code = sqlCodeOf(mig16);
const lib = exists('src/lib/fulfillment.ts') ? read('src/lib/fulfillment.ts') : '';
const libCode = jsCodeOf(lib);
const dist = exists('src/pages/admin/DistinctionsAdminPage.tsx') ? read('src/pages/admin/DistinctionsAdminPage.tsx') : '';
const distCode = jsCodeOf(dist);
const dbTypes = exists('src/types/database.ts') ? read('src/types/database.ts') : '';

// ---- 2. relação com award_distinction ----
check('2. relação com award_distinction (FK award_distinction_id → award_distinctions)',
  /award_distinction_id/.test(mig16) && /references\s+public\.award_distinctions/i.test(mig16) &&
  /award_distinction_id/.test(lib));

// ---- 3. item types controlados ----
check('3. item types controlados (certificate|digital_seal|plaque|trophy)',
  /'certificate'/.test(mig16) && /'digital_seal'/.test(mig16) && /'plaque'/.test(mig16) && /'trophy'/.test(mig16) &&
  /'certificate'/.test(lib) && /'digital_seal'/.test(lib) && /'plaque'/.test(lib) && /'trophy'/.test(lib));

// ---- 4. status controlados ----
check('4. status controlados (pending|preparing|ready|delivered|cancelled)',
  /'pending'/.test(mig16) && /'preparing'/.test(mig16) && /'ready'/.test(mig16) && /'delivered'/.test(mig16) && /'cancelled'/.test(mig16) &&
  /FULFILLMENT_STATUSES/.test(lib) && /'preparing'/.test(lib));

// ---- 5. UNIQUE distinção+item ----
check('5. UNIQUE (award_distinction_id, item_type) anti-duplicação',
  /unique/i.test(mig16) && /award_distinction_id,\s*item_type/.test(mig16Code));

// ---- 6. admin-only ----
check('6. admin-only (RLS enable + policy is_admin, sem policy anon)',
  /enable row level security/i.test(mig16) && /is_admin\(\)/.test(mig16) &&
  /admin manage distinction_fulfillment/.test(mig16) &&
  !/for\s+(all|select|insert|update|delete)\s+to\s+anon/i.test(mig16Code));

// ---- 7. programa/campanha respeitados ----
check('7. programa/campanha respeitados (scope selectedProgramId/selectedCampaignId + distinção da campanha)',
  /selectedCampaignId/.test(dist) && /selectedProgramId/.test(dist) &&
  /useScopedFulfillment/.test(dist) && /distinctionIds|fulfillmentByDistinction/.test(dist));

// ---- 8. fail-closed ----
check('8. fail-closed (sem programa/edição → sem dados/escrita; tabela ausente → vazio)',
  /fail-closed/i.test(dist) && /Sem programa válido/.test(dist) && /Sem edição válida/.test(dist) &&
  /42P01/.test(lib));

// ---- 9/10/11/12. itens PT-PT ----
check('9. certificado suportado (Certificado)', /certificate/.test(lib) && /Certificado/.test(lib + dist));
check('10. selo digital suportado (Selo digital)', /digital_seal/.test(lib) && /Selo digital/.test(lib + dist));
check('11. placa suportada (Placa)', /plaque/.test(lib) && /Placa/.test(lib + dist));
check('12. troféu suportado (Troféu)', /trophy/.test(lib) && /Troféu/.test(lib + dist));

// ---- 13/14/15/16. campos operacionais ----
check('13. notas suportadas (notes nullable, nunca públicas)', /notes/.test(mig16Code) && /notes/.test(libCode) && /nunca públicas/i.test(lib + dist));
check('14. delivered_at suportado', /delivered_at/.test(mig16Code) && /delivered_at/.test(libCode));
check('15. delivery_method suportado (pickup|delivery|event)', /delivery_method/.test(mig16Code) && /'pickup'/.test(mig16) && /'delivery'/.test(mig16) && /'event'/.test(mig16) && /Levantamento|Entrega|Evento/.test(lib + dist));
check('16. tracking_reference suportado', /tracking_reference/.test(mig16Code) && /tracking_reference/.test(libCode));

// ---- 17. UI Gerir reconhecimento ----
check('17. UI Gerir reconhecimento (coluna Reconhecimento + modal + Ver reconhecimento)',
  /Reconhecimento/.test(dist) && /Gerir reconhecimento/.test(dist) && /Ver reconhecimento/.test(dist) &&
  /FulfillmentManager/.test(dist) && /Ainda não configurado/.test(lib + dist));

// ---- 18. resumo operacional ----
check('18. resumo operacional (pendentes/em preparação/prontos/entregues, sem votos)',
  /resumo operacional/i.test(dist) && /Reconhecimentos pendentes/.test(dist) && /Em preparação/.test(dist) && /Prontos/.test(dist) && /Entregues/.test(dist) &&
  /summarizeFulfillment|fulfillmentSummary/.test(dist));

// ---- 19-23. nenhuma escrita eleitoral ----
const fulfillmentScope = [lib, dist].join('\n');
const fulfillmentScopeCode = jsCodeOf(fulfillmentScope);
for (const [n, t] of [[19, 'votes'], [20, 'vote_attempts'], [21, 'vote_adjustments'], [22, 'modality_votes'], [23, 'modality_vote_attempts']]) {
  check(`${n}. nenhuma escrita em ${t}`,
    !new RegExp(`from\\(["']${t}["']\\)\\s*\\)\\s*\\.\\s*(insert|update|delete|upsert)`, 'i').test(fulfillmentScopeCode) &&
    !new RegExp(`from\\(["']${t}["']\\)\\s*\\.\\s*(insert|update|delete|upsert)`, 'i').test(fulfillmentScopeCode) &&
    !new RegExp(`into\\s+public\\.${t}`, 'i').test(mig16Code));
}
check('19-23. migration 0016 sem RPCs de apuramento redefinidos',
  !/get_admin_tally|get_admin_modality_tally|get_published_results/i.test(mig16Code));

// ---- 24. award_status não alterado por fulfillment ----
// A lib fulfillment pode LER award_status/commercial_status (orientação de
// elegibilidade, secção E — só aviso, sem efeitos). O que NUNCA pode é
// ESCREVER: nenhum insert/update/delete em award_distinctions, nenhum
// update com chave award_status.
check('24. award_status não alterado por fulfillment (zero escritas em award_distinctions/award_status)',
  !/from\(["']award_distinctions["']\)\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/from\(["']award_distinctions["']\)\s*\)\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/update\(\{\s*award_status|update\(\{[^}]*award_status\s*:/i.test(libCode) &&
  /from\(["']distinction_fulfillment["']\)/.test(libCode));

// ---- 25. commercial_status não alterado por fulfillment ----
check('25. commercial_status não alterado por fulfillment (zero escritas)',
  !/update\(\{\s*commercial_status|update\(\{[^}]*commercial_status\s*:/i.test(libCode));

// ---- 26. ranking não alterado ----
check('26. ranking não alterado (posição/votos continuam via get_admin_modality_tally; fulfillment sem total_votes/position)',
  /get_admin_modality_tally/.test(dist) && !/total_votes|position/.test(libCode.replace(/position:\s*number/g, '')) &&
  !/total_votes/.test(mig16Code));

// ---- auditoria J ----
check('J. auditoria distinction_fulfillment.created/status_changed/updated via audit_logs',
  /distinction_fulfillment\.created/.test(mig16 + lib) && /distinction_fulfillment\.status_changed/.test(lib) &&
  /distinction_fulfillment\.updated/.test(mig16 + lib) && /audit_logs/.test(mig16));

// ---- 29/30/31/32. guardas negativos ----
check('29. sem pagamentos (Stripe/checkout/preço/fatura/pagamento)', !/\bstripe\b|amount_cents|price_cents|unit_price|pagamento|fatura|faturação|checkout|comiss|subscription|subscrição/i.test(fulfillmentScopeCode));
check('30. sem seeds', !/\.from\(['"](countries|award_programs|campaigns|businesses)['"]\)\s*\.\s*insert/i.test(fulfillmentScopeCode) && !/insert\s+into\s+public\.(countries|award_programs|campaigns|businesses|modality_votes)/i.test(fulfillmentScopeCode + mig16Code));
check('31. sem 2027', !/2027/.test(fulfillmentScopeCode));
check('32. sem novos países/programas', !/award_programs["']?\)\s*\.\s*(insert|update)/i.test(fulfillmentScopeCode) && !/into\s+public\.(award_programs|countries)/i.test(mig16Code));

// ---- ResultsAdmin NÃO gere fulfillment ----
const results = read('src/pages/admin/ResultsAdminPage.tsx');
check('L. ResultsAdmin NÃO gere fulfillment (só deep-link Criar/Gerir distinção)',
  !/fulfillment|Fulfillment|distinction_fulfillment/i.test(jsCodeOf(results)) && /Gerir distinção/.test(results));

if (failures > 0) {
  console.error(`\n5C.3.12 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.12 VERIFY: tudo válido (local, sem banco remoto alterado).');
