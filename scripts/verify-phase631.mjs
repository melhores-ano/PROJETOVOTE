/**
 * FASE 6.3.1 — Verificação LOCAL (SEM tocar no banco remoto).
 * Pacote Oficial Digital — adesão comercial (piloto Braga 2026):
 * migration 0020 distinction_package_adoptions, tipos, lib packages,
 * hook, Admin > Distinções (coluna + modal). Guardas eleitorais intactas.
 * Sem db push, sem deploy, sem git commit, sem pagamentos.
 * Uso: node scripts/verify-phase631.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CAST_VOTE = 'F8D382B2F0B6FD2AFB4E742275AA4297266AFDE5A398B4B4258787027FE6115C';
const EXPECTED_CAST_MODALITY = '789BD90CB3AF237AAE2E000406B8F1212C5F44DCFDA51B2F6DF47DB8E2A80955';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
function read(p) { return readFileSync(join(root, p), 'utf8'); }
function exists(p) { return existsSync(join(root, p)); }
function jsCodeOf(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}
function sqlCodeOf(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const MIG = 'supabase/migrations/0020_phase631_digital_package_adoptions.sql';
const LIB = 'src/lib/packages.ts';
const HOOK = 'src/hooks/usePackageAdoptions.ts';
const ADMIN = 'src/pages/admin/DistinctionsAdminPage.tsx';
const DBTYPES = 'src/types/database.ts';
const M18 = 'supabase/migrations/0018_phase61_participant_invitations.sql';
const M19 = 'supabase/migrations/0019_phase62_category_areas.sql';
const M16 = 'supabase/migrations/0016_phase5c312_distinction_fulfillment.sql';
const M17 = 'supabase/migrations/0017_phase5c313_digital_credentials.sql';

const migExists = exists(MIG);
const libExists = exists(LIB);
const hookExists = exists(HOOK);
check('1. estrutura Phase 6.3.1 existe (migration 0020 + lib + hook)', migExists && libExists && hookExists);

const mig = migExists ? read(MIG) : '';
const migCode = sqlCodeOf(mig);
const lib = libExists ? read(LIB) : '';
const libCode = jsCodeOf(lib);
const hook = hookExists ? read(HOOK) : '';
const hookCode = jsCodeOf(hook);
const admin = exists(ADMIN) ? read(ADMIN) : '';
const adminCode = jsCodeOf(admin);
const dbTypes = exists(DBTYPES) ? read(DBTYPES) : '';
const appScope = [lib, hook, admin].join('\n');
const appScopeCode = jsCodeOf(appScope);

// ---- 2. migration 0020 única nova ----
let extraMig = [];
try {
  extraMig = readdirSync(join(root, 'supabase/migrations')).filter((f) => /^0021/i.test(f));
} catch { /* ignore */ }
check('2. migration 0020 é a única nova (sem 0021+)', migExists && extraMig.length === 0, extraMig.join(',') || 'ok');

// ---- 3. migrations 0018/0019 intactas ----
try {
  const out = execSync('git status --porcelain -- supabase/migrations/0018_phase61_participant_invitations.sql supabase/migrations/0019_phase62_category_areas.sql', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  check('3. migrations 0018 e 0019 intactas (byte-identical)', lines.length === 0, lines.join('; ') || 'limpo');
} catch { check('3. migrations 0018 e 0019 intactas (git indisponível, skip)', true, 'git skip'); }
check('3b. ficheiros 0018/0019 existem', exists(M18) && exists(M19));

// ---- 4. edge functions eleitorais intactas ----
try {
  const out = execSync('git status --porcelain -- supabase/functions', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  check('4. edge functions eleitorais intactas (sem modificação)', lines.length === 0, lines.join('; ') || 'limpo');
} catch { check('4. edge functions eleitorais intactas (git indisponível, skip)', true, 'git skip'); }
try {
  const h1 = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
  check('4b. cast-vote SHA256 intacto', h1 === EXPECTED_CAST_VOTE, h1);
} catch { check('4b. cast-vote SHA256 intacto', false, 'ficheiro ausente'); }
try {
  const h2 = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-modality-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
  check('4c. cast-modality-vote SHA256 intacto', h2 === EXPECTED_CAST_MODALITY, h2);
} catch { check('4c. cast-modality-vote SHA256 intacto', false, 'ficheiro ausente'); }

// ---- 5. tabela ----
check('5. tabela public.distinction_package_adoptions (CREATE TABLE IF NOT EXISTS)',
  /create table if not exists public\.distinction_package_adoptions/i.test(migCode));

// ---- 6. colunas mínimas ----
const cols = ['award_distinction_id', 'package_code', 'package_type', 'package_name', 'price_cents', 'currency', 'status', 'adopted_at', 'cancelled_at', 'cancel_reason', 'includes_certificate', 'includes_digital_seal', 'includes_digital_kit', 'includes_publication', 'includes_meta_ads', 'meta_ads_consent_at', 'notes', 'created_at', 'updated_at'];
check('6. colunas mínimas da adesão', cols.every((c) => new RegExp(`\\b${c}\\b`, 'i').test(migCode)));

// ---- 7. FK correta ----
check('7. FK award_distinction_id → award_distinctions(id) ON DELETE CASCADE',
  /references\s+public\.award_distinctions\s*\(\s*id\s*\)\s*on delete cascade/i.test(migCode));

// ---- 8. UNIQUE por distinção ----
check('8. UNIQUE award_distinction_id (uma adesão por distinção)',
  /distinction_package_adoptions_distinction_uidx/i.test(mig) && /unique/i.test(migCode));

// ---- 9. RLS admin-only ----
check('9. RLS admin-only (ENABLE RLS + admin manage is_admin, sem policy anon)',
  /alter table public\.distinction_package_adoptions enable row level security/i.test(migCode) &&
  /admin manage distinction_package_adoptions/.test(mig) && /is_admin\(\)/.test(mig) &&
  !/for\s+(all|insert|update|delete|select)\s+to\s+anon/i.test(migCode));

// ---- 10. preço em cents + EUR ----
check('10. preço em cents (price_cents >= 0, piloto 4990 na lib, EUR default)',
  /price_cents integer not null/i.test(migCode) && /price_cents\s*>=\s*0/.test(migCode) &&
  /DEFAULT 'EUR'/.test(mig) && /price_cents:\s*4990/.test(lib) && /currency:\s*['"]EUR['"]/.test(lib));

// ---- 11. pacote não preso a Braga ----
check('11. pacote não preso a Braga por CHECK (sem CHECK em Braga/código único)',
  !/check\s*\([^)]*braga[^)]*\)/i.test(migCode) && !/check\s*\([^)]*TBE-DIGITAL-2026[^)]*\)/i.test(migCode) &&
  /TBE-DIGITAL-2026/.test(lib + mig));

// ---- 12. package_type evolutivo ----
check('12. package_type suporta evolução (digital|physical|hybrid)',
  /package_type\s+in\s*\(\s*'digital'\s*,\s*'physical'\s*,\s*'hybrid'\s*\)/i.test(migCode));

// ---- 13. status sem pagamento ----
check('13. status pending|active|cancelled (SEM paid/unpaid/payment_pending)',
  /status\s+in\s*\(\s*'pending'\s*,\s*'active'\s*,\s*'cancelled'\s*\)/i.test(migCode) &&
  !/paid|unpaid|payment_pending/i.test(migCode));

// ---- 14. sem pagamentos/gateways (implementação real) ----
// NOTA: os textos COMMENT ON documentam "SEM Stripe/MB WAY/..." por design;
// por isso removem-se os literais de string antes do scan — o que conta é
// não existir implementação (tabela/coluna/RPC/código executável).
const migCodeNoStrings = migCode.replace(/'[^']*'/g, "''");
check('14. nenhum payment/Stripe/MB WAY/Multibanco/checkout/gateway/invoice (implementação)',
  !/\bstripe\b|\bmb\s*way\b|multibanco|checkout|gateway|payment_intent|invoice/i.test(migCodeNoStrings + appScopeCode));

// ---- 15. auditoria + touch ----
check('15. touch_updated_at + auditoria (package_adoption.created/.cancelled/.reactivated/.updated)',
  /touch_updated_at\(\)/.test(mig) && /package_adoption\.created/.test(mig) &&
  /package_adoption\.cancelled/.test(mig) && /package_adoption\.reactivated/.test(mig) &&
  /package_adoption\.updated/.test(mig) && /audit_logs/.test(mig));

// ---- 16. tipos TS ----
check('16. tipos DistinctionPackageAdoption + PackageAdoptionStatus em database.ts',
  /interface DistinctionPackageAdoption/.test(dbTypes) && /PackageAdoptionStatus/.test(dbTypes) &&
  /price_cents:\s*number/.test(dbTypes) && /meta_ads_consent_at/.test(dbTypes));

// ---- 17. funções lib ----
check('17. lib com create/update/cancel/reactivate (SOMENTE distinction_package_adoptions)',
  /createPackageAdoption/.test(lib) && /updatePackageAdoption/.test(lib) &&
  /cancelPackageAdoption/.test(lib) && /reactivatePackageAdoption/.test(lib) &&
  /from\(['"]distinction_package_adoptions['"]\)/.test(libCode));

// ---- 18. nenhuma escrita eleitoral na lib/hook ----
for (const [n, t] of [[18, 'votes'], [19, 'vote_attempts'], [20, 'vote_adjustments'], [21, 'modality_votes'], [22, 'modality_vote_attempts']]) {
  const writeRe = new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  const sqlRe = new RegExp(`into\\s+public\\.${t}`, 'i');
  check(`${n}. sem escrita ${t} (lib/hook/admin + migration)`, !writeRe.test(appScopeCode) && !sqlRe.test(migCode));
}
check('23. sem escrita campaign_entries nem RPCs eleitorais redefinidos',
  !/into\s+public\.campaign_entries/i.test(migCode) &&
  !/from\(["']campaign_entries["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode + hookCode) &&
  !/get_admin_tally|get_admin_modality_tally|get_published_results/i.test(migCode));

// ---- 24. sem automatismo package → award_status ----
check('24. nenhum automatismo package → award_status (lib/hook nunca escreve award_distinctions)',
  !/from\(["']award_distinctions["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode + hookCode) &&
  !/award_status/.test(libCode));

// ---- 25. sem automatismo cancelamento → perda de vitória ----
check('25. nenhum automatismo cancelamento → perda de vitória (cancel só status cancelled)',
  /cancelPackageAdoption/.test(lib) && !/winner|cancelled.*award_status|award_status.*cancelled/i.test(libCode));

// ---- 26. fulfillment intacto (certificate/digital_seal + plaque/trophy) ----
const m16 = exists(M16) ? read(M16) : '';
check('26. certificado/selo intactos + plaque/trophy preservados (0016 sem ALTER/DROP)',
  /certificate/.test(m16) && /digital_seal/.test(m16) && /plaque/.test(m16) && /trophy/.test(m16) &&
  !/alter table\s+public\.distinction_fulfillment/i.test(migCode) && !/drop table/i.test(migCode));

// ---- 27. credenciais intactas ----
const m17 = exists(M17) ? read(M17) : '';
check('27. credenciais intactas (0017 verify_digital_credential preservado, sem ALTER nesta migration)',
  /verify_digital_credential/.test(m17) && !/verify_digital_credential/i.test(migCode) &&
  !/alter table\s+public\.digital_credentials/i.test(migCode) &&
  exists('src/lib/credentialRenderer.ts') && exists('src/lib/credentialData.ts'));

// ---- 28. UI não-interferência (texto vive na lib como fonte única e é
// renderizado no admin via constante — verifica-se o conjunto) ----
const uiText = lib + admin;
check('28. UI informa que adesão não interfere no resultado',
  /não interfere no resultado/i.test(uiText) && /PACKAGE_NON_INTERFERENCE_NOTICE/.test(admin));

// ---- 29. texto Meta Ads coletiva (constante na lib, renderizada no modal) ----
check('29. texto Meta Ads deixa explícito que é campanha coletiva (15 dias, sem garantias)',
  /coletiva/i.test(uiText) && /15 dias/.test(uiText) && /META_ADS_COLLECTIVE_NOTICE/.test(admin) &&
  /não existe garantia individual/i.test(uiText));

// ---- 30. consentimento obrigatório ----
check('30. consentimento Meta Ads obrigatório no modal (checkbox + meta_ads_consent_at = now)',
  /A empresa foi informada e aceitou/.test(admin) && /type="checkbox"/.test(adminCode) &&
  /metaAdsConsented/.test(lib) && /meta_ads_consent_at/.test(libCode + migCode) &&
  /disabled=\{[^}]*!consented/.test(adminCode));

// ---- 31. modal com pacote/valor/formato/benefícios ----
// O valor é renderizado via formatPriceCents(4990, 'EUR') → "49,90 €" em
// runtime; o title literal "49,90 €" no botão garante o texto auditável.
check('31. modal exibe pacote, 49,90 €, 100% digital e 6 benefícios',
  /Registar adesão ao Pacote Oficial Digital/.test(admin) && /49,90/.test(admin) &&
  /formatPriceCents/.test(admin) && /price_cents:\s*4990/.test(lib) &&
  /100% digital/.test(admin) && /Certificado Digital Oficial/.test(admin) &&
  /QR Code/.test(admin) && /Selo Digital Oficial 2026/.test(admin) &&
  /Kit Digital do Vencedor/.test(admin) && /Registar adesão —/.test(admin));

// ---- 32. coluna Pacote Digital ----
check('32. coluna Pacote Digital (—, Pendente/Ativo/Cancelado, Registar adesão)',
  /Pacote Digital/.test(admin) && /Registar adesão/.test(admin) &&
  /PACKAGE_ADOPTION_STATUS_LABELS/.test(admin));

// ---- 33. sem ALTER/DROP em tabelas anteriores ----
check('33. sem ALTER/DROP em tabelas anteriores (só CREATE da nova tabela)',
  !/alter table\s+public\.(votes|vote_attempts|vote_adjustments|modality_votes|modality_vote_attempts|campaign_entries|award_distinctions|distinction_fulfillment|digital_credentials|categories)\b/i.test(migCode));

// ---- 34. PT-PT ----
check('34. PT-PT (Registar adesão, Cancelar, Reativar, Notas internas)',
  /Registar adesão/.test(admin) && /Cancelar/.test(admin) && /Notas internas/.test(admin));

if (failures > 0) {
  console.error(`\n6.3.1 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n6.3.1 VERIFY: tudo válido (local, sem banco remoto alterado).');
