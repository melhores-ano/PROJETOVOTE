/**
 * FASE 5C.3.13 — Verificação LOCAL (SEM tocar no banco remoto).
 * Certificados e selos digitais verificáveis: emissão com código único não
 * previsível, idempotência por ativo, estados issued|revoked, revogação com
 * histórico preservado, verificação pública controlada via RPC, RLS
 * admin-only, auditoria via audit_logs, PT-PT, fail-closed.
 * Sem db push, sem deploy, sem seeds, sem git, sem pagamentos.
 * Uso: node scripts/verify-phase5c313.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
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

const MIG = 'supabase/migrations/0017_phase5c313_digital_credentials.sql';
const LIB = 'src/lib/digitalCredentials.ts';
const ADMIN = 'src/pages/admin/DistinctionsAdminPage.tsx';
const VERIFY_PAGE = 'src/pages/public/VerifyPage.tsx';
const APP = 'src/App.tsx';
const ROUTES = 'src/lib/programRoute.ts';
const DBTYPES = 'src/types/database.ts';
const HOOKS = 'src/hooks/useAdminData.ts';

const migExists = exists(MIG);
const libExists = exists(LIB);
check('1. estrutura digital credential existe (migration + lib + tipos + UI)', migExists && libExists && exists(VERIFY_PAGE) && exists(ADMIN));

const mig = migExists ? read(MIG) : '';
const migCode = sqlCodeOf(mig);
const lib = libExists ? read(LIB) : '';
const libCode = jsCodeOf(lib);
const admin = exists(ADMIN) ? read(ADMIN) : '';
const adminCode = jsCodeOf(admin);
const verifyPage = exists(VERIFY_PAGE) ? read(VERIFY_PAGE) : '';
const verifyPageCode = jsCodeOf(verifyPage);
const app = exists(APP) ? read(APP) : '';
const routes = exists(ROUTES) ? read(ROUTES) : '';
const dbTypes = exists(DBTYPES) ? read(DBTYPES) : '';
const hooks = exists(HOOKS) ? read(HOOKS) : '';
const hooksCode = jsCodeOf(hooks);

// ---- 2. FK para distinção ----
check('2. FK para distinção (award_distinction_id → award_distinctions)',
  /award_distinction_id/.test(mig) && /references\s+public\.award_distinctions/i.test(mig) &&
  /award_distinction_id/.test(lib));

// ---- 3. relação fulfillment quando usada ----
check('3. relação fulfillment quando usada (fulfillment_id opcional → distinction_fulfillment)',
  /fulfillment_id/.test(mig) && /references\s+public\.distinction_fulfillment/i.test(mig) &&
  /fulfillment_id/.test(lib));

// ---- 4/5. tipos ----
check('4. certificate suportado', /'certificate'/.test(mig) && /'certificate'/.test(lib) && /Certificado/.test(lib + admin + verifyPage));
check('5. digital_seal suportado', /'digital_seal'/.test(mig) && /'digital_seal'/.test(lib) && /Selo digital/.test(lib + admin + verifyPage));

// ---- 6. código UNIQUE ----
check('6. código UNIQUE (verification_code TEXT NOT NULL UNIQUE)',
  /verification_code/i.test(mig) && /unique/i.test(mig) && /verification_code/.test(lib));

// ---- 7. código não incremental/previsível ----
check('7. código não incremental/previsível (entropia segura, sem business_id/distinction_id/serial/ranking)',
  /getRandomValues|crypto|entrop/i.test(lib) && /TBE-/.test(mig + lib) &&
  !/serial|nextval/i.test(migCode) &&
  !/business_id\s*\|\||distinction_id\s*\|\||position\s*\|\|/i.test(libCode));

// ---- 8. issued/revoked ----
check('8. issued/revoked (só estes dois estados)',
  /'issued'/.test(mig) && /'revoked'/.test(mig) &&
  /'issued'/.test(lib) && /'revoked'/.test(lib) &&
  !/'draft'|"draft"|'paid'|"paid"|'expired'|"expired"|'ordered'|"ordered"/.test(migCode));

// ---- 9. revogação preserva registo ----
check('9. revogação preserva registo (UPDATE issued→revoked, sem DELETE como fluxo)',
  /revoked_at/.test(mig) && /revoked_at/.test(lib) &&
  !/\.from\(["']digital_credentials["']\)\s*\.\s*delete/i.test(libCode) &&
  !/delete\s+from\s+public\.digital_credentials/i.test(migCode));

// ---- 10. revocation_reason administrativo ----
check('10. revocation_reason administrativo (obrigatório, nunca público)',
  /revocation_reason/.test(mig) && /revocation_reason/.test(lib) &&
  /Motivo da revogação obrigatório/i.test(admin + lib));

// ---- 11. consulta pública controlada ----
check('11. consulta pública controlada (RPC verify_digital_credential SECURITY DEFINER)',
  /verify_digital_credential/.test(mig) && /security definer/i.test(mig) &&
  /verify_digital_credential/.test(libCode));

// ---- 12. sem SELECT público irrestrito ----
check('12. sem SELECT público irrestrito (RLS admin-only, sem policy anon, RPC com GRANT EXECUTE)',
  /enable row level security/i.test(mig) && /is_admin\(\)/.test(mig) &&
  /admin manage digital_credentials/.test(mig) &&
  !/for\s+(all|select|insert|update|delete)\s+to\s+anon/i.test(migCode) &&
  !/\.from\(["']digital_credentials["']\)\s*\.\s*select/i.test(verifyPageCode));

// ---- 13/14. rotas ----
check('13. rota /:programPrefix/verificar (formulário "Introduza o código de verificação")',
  /verificar/.test(routes) && /verificar/.test(app) && /Introduza o código de verificação/.test(verifyPage));
check('14. rota código (/:programPrefix/verificar/:verificationCode)',
  /verificar\/:verificationCode/.test(app) && /verificationCode/.test(verifyPage));

// ---- 15/16/17. estados públicos ----
check('15. estado válido (CREDENCIAL AUTÊNTICA / Credencial autêntica)', /Credencial autêntica/i.test(verifyPage));
check('16. estado revogado (CREDENCIAL REVOGADA / Credencial revogada, sem motivo público)',
  /Credencial revogada/i.test(verifyPage) && !/revocation_reason|revocationReason/.test(verifyPageCode));
check('17. código inexistente (CÓDIGO NÃO ENCONTRADO / Código não encontrado, fail-closed)',
  /Código não encontrado/i.test(verifyPage));

// ---- 18/19/20. admin ----
check('18. admin emissão (Gerar credencial + validações + auditoria)',
  /Gerar credencial/.test(admin) && /issueCredential/.test(adminCode) && /hasCampaign/.test(admin));
check('19. admin revogação (Revogar + revoked_at + audit log)',
  /Revogar/.test(admin) && /revokeCredential/.test(adminCode));
check('20. confirmação de revogação (confirmação explícita + motivo obrigatório)',
  /Confirmar revogação/i.test(admin) && /revokeReason|revoke-reason/.test(admin));

// ---- 21/22. auditoria ----
check('21. auditoria issued (digital_credential.issued via audit_logs)',
  /digital_credential\.issued/.test(mig + lib));
check('22. auditoria revoked (digital_credential.revoked via audit_logs)',
  /digital_credential\.revoked/.test(mig + lib));

// ---- 23-27. nenhuma escrita eleitoral ----
const credScope = [lib, admin].join('\n');
const credScopeCode = jsCodeOf(credScope);
for (const [n, t] of [[23, 'votes'], [24, 'vote_attempts'], [25, 'vote_adjustments'], [26, 'modality_votes'], [27, 'modality_vote_attempts']]) {
  const writeRe = new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  const sqlRe = new RegExp(`into\\s+public\\.${t}`, 'i');
  check(`${n}. sem escrita ${t}`, !writeRe.test(credScopeCode) && !sqlRe.test(migCode));
}
check('23-27. migration 0017 sem RPCs de apuramento redefinidos',
  !/get_admin_tally|get_admin_modality_tally|get_published_results/i.test(migCode));

// ---- 28. award_status não alterado ----
check('28. award_status não alterado (zero escritas em award_status)',
  !/from\(["']award_distinctions["']\)\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/award_status\s*:/.test(libCode));

// ---- 29. commercial_status não alterado ----
check('29. commercial_status não alterado (zero escritas em commercial_status)',
  !/commercial_status\s*:/.test(libCode));

// ---- 30. fulfillment não altera resultado ----
check('30. fulfillment não altera resultado (placa/troféu/delivery/tracking intactos, sem escrita em distinction_fulfillment)',
  !/from\(["']distinction_fulfillment["']\)\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  /plaque/.test(read('src/lib/fulfillment.ts')) && /delivery_method/.test(read('supabase/migrations/0016_phase5c312_distinction_fulfillment.sql')));

// ---- 31. cast-vote intacto ----
const castVoteHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('31. cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const castVoteEdge = read('supabase/functions/cast-vote/index.ts');
check('31. cast-vote sem referências a credenciais/verificação', !/digital_credential|verificar|verification_code|credential/i.test(castVoteEdge));

// ---- 32. cast-modality-vote intacto ----
const edgeMod = read('supabase/functions/cast-modality-vote/index.ts');
const edgeModCode = jsCodeOf(edgeMod);
check('32. cast-modality-vote intacto (sem credenciais/distinções/fulfillment)',
  !/digital_credential|verification_code|distinction_fulfillment/i.test(edgeModCode));

// ---- 33-36. guardas negativos ----
check('33. sem pagamentos (Stripe/checkout/preço/fatura/pagamento)', !/\bstripe\b|amount_cents|price_cents|unit_price|pagamento|fatura|faturação|checkout|subscription|subscrição/i.test(credScopeCode));
check('34. sem 2027', !/2027/.test(credScopeCode + verifyPageCode));
check('35. sem novo país/programa', !/into\s+public\.(award_programs|countries)/i.test(migCode) && !/['"]fr['"]|['"]be['"]/.test(libCode));
check('36. sem seeds', !/\.from\(['"](countries|award_programs|campaigns|businesses)['"]\)\s*\.\s*insert/i.test(credScopeCode) && !/insert\s+into\s+public\.(countries|award_programs|campaigns|businesses|modality_votes)/i.test(credScopeCode + migCode));

// ---- 37. PT-PT ----
check('37. PT-PT (Emitido/Revogado/Certificado/Selo digital/Código não encontrado)',
  /Emitido/.test(lib + admin) && /Revogado/.test(lib + admin) && /Código não encontrado/i.test(verifyPage) && /Data de emissão/i.test(admin + verifyPage));

// ---- 38. fail-closed ----
check('38. fail-closed (sem programa/edição → sem emissão; RPC vazia → não encontrado; tabela ausente → vazio)',
  /fail-closed/i.test(admin + lib) && /42P01/.test(lib) && /found:\s*false/.test(libCode));

// ---- extras: tipos + hook + QR-ready ----
check('X1. tipos DigitalCredential em database.ts', /DigitalCredential/.test(dbTypes) && /DigitalCredentialType/.test(dbTypes) && /DigitalCredentialStatus/.test(dbTypes));
check('X2. hook useScopedCredentials isolado por distinções', /useScopedCredentials/.test(hooks) && /useScopedCredentials/.test(admin));
check('X3. URL verificável /pt/verificar/CODIGO (QR-ready, sem dependência pesada)',
  /verificar\//.test(lib + admin) && !/qrcode\.react|react-qr-code|qrcode\//i.test(read('package.json')));

if (failures > 0) {
  console.error(`\n5C.3.13 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.13 VERIFY: tudo válido (local, sem banco remoto alterado).');
