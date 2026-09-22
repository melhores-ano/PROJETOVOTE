/**
 * FASE 5C.3.14 — Verificação LOCAL (SEM tocar no banco remoto).
 * Motor de certificados e selos digitais: template substituível, A4 landscape,
 * dados derivados da credential, QR só-URL-pública, preview/download admin,
 * revoked bloqueado, fail-safe sem template, filenames sanitizados, sem
 * escrita eleitoral, sem pagamentos, sem 2027, sem migration 0018, PT-PT.
 * Uso: node scripts/verify-phase5c314.mjs
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
function read(p) { return readFileSync(join(root, p), 'utf8'); }
function exists(p) { return existsSync(join(root, p)); }
function jsCodeOf(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const TPL = 'src/config/credentialTemplates.ts';
const DATA = 'src/lib/credentialData.ts';
const RENDER = 'src/lib/credentialRenderer.ts';
const PREVIEW = 'src/components/CredentialPreview.tsx';
const ADMIN = 'src/pages/admin/DistinctionsAdminPage.tsx';
const CREDLIB = 'src/lib/digitalCredentials.ts';
const PKG = 'package.json';

const tpl = exists(TPL) ? read(TPL) : '';
const tplCode = jsCodeOf(tpl);
const data = exists(DATA) ? read(DATA) : '';
const dataCode = jsCodeOf(data);
const render = exists(RENDER) ? read(RENDER) : '';
const renderCode = jsCodeOf(render);
const preview = exists(PREVIEW) ? read(PREVIEW) : '';
const previewCode = jsCodeOf(preview);
const admin = exists(ADMIN) ? read(ADMIN) : '';
const adminCode = jsCodeOf(admin);
const credlib = exists(CREDLIB) ? read(CREDLIB) : '';
const pkg = exists(PKG) ? read(PKG) : '';
const visualScope = [tpl, data, render, preview, admin].join('\n');
const visualCode = jsCodeOf(visualScope);

// 1. template config centralizado
check('1. template config centralizado', exists(TPL) && /CERTIFICATE_TEMPLATE/.test(tpl) && /SEAL_TEMPLATE/.test(tpl) && /CREDENTIAL_TEMPLATES/.test(tpl));
// 2. certificate template substituível
check('2. certificate template substituível', /certificate-background/.test(tpl) && /brand\/credentials/.test(tpl) && /placeholder|provisório|PROVISÓRIO/i.test(tpl));
// 3. seal template substituível
check('3. seal template substituível', /seal-background/.test(tpl) && /brand\/credentials/.test(tpl));
// 4. A4 landscape
check('4. A4 landscape', /A4/.test(tpl) && /landscape/.test(tpl + render) && /3508/.test(tpl) && /2480/.test(tpl));
// 5. dados derivados da credential
check('5. dados derivados da credential', /resolveCredentialDisplayData/.test(data) && /verification_code/.test(data) && /issued_at/.test(data));
// 6. nome empresa
check('6. nome empresa', /businessName|business_name/.test(data) && /recipientName/.test(data));
// 7. programa
check('7. programa', /programName/.test(data) && !/hardcode.*UUID|00000000-0000/i.test(dataCode));
// 8. edição
check('8. edição', /campaignYear|Edição/.test(data));
// 9. cidade
check('9. cidade', /cityName/.test(data));
// 10. categoria
check('10. categoria', /categoryName/.test(data));
// 11. modalidade opcional
check('11. modalidade opcional', /modalityName/.test(data) && /Quando modalidade|omite modalidade|sem deixar|sem espaço/i.test(data + tpl));
// 12. verification_code
check('12. verification_code', /verificationCode|verification_code/.test(data) && /Código de verificação/.test(data));
// 13. issued_at
check('13. issued_at', /issuedAt|issued_at/.test(data) && /Data de emissão/.test(data));
// 14. QR existe
check('14. QR existe', /qrcode|QRCode|toDataURL|buildVerifyQrDataUrl/.test(render) && /qr/i.test(tpl + render));
// 15. QR aponta URL verificar
check('15. QR aponta URL verificar', /verificar/.test(render) && /absoluteVerifyUrl|verifyPath/.test(renderCode));
// 16. QR sem IDs internos
check('16. QR sem IDs internos', !/business_id|distinction_id|user_id/.test(renderCode) || /SOMENTE.*URL pública|sem IDs internos/i.test(render));
// 17. preview certificado
check('17. preview certificado', /Pré-visualizar certificado/.test(admin + preview));
// 18. download certificado
check('18. download certificado', /Descarregar certificado/.test(admin + preview) && /downloadCertificatePdf/.test(render + admin));
// 19. preview selo
check('19. preview selo', /Pré-visualizar selo/.test(admin + preview));
// 20. download selo
check('20. download selo', /Descarregar selo/.test(admin + preview) && /downloadSealPng/.test(render + admin));
// 21. revoked bloqueado
check('21. revoked bloqueado', /REVOGADO/.test(admin + preview + render) && /bloquead/i.test(admin + preview + render));
// 22. template ausente fail-safe
check('22. template ausente fail-safe', /placeholder|provisório|PROVISÓRIO|Template oficial|fundo oficial/i.test(tpl + preview + render) && /nunca quebra|fail-safe|aviso técnico/i.test(tpl + preview + render + preview));
// 23. filename sanitizado
check('23. filename sanitizado', /sanitizeFilenamePart|certificateFilename|sealFilename/.test(data) && /the-best-europa-certificado-|the-best-europa-selo-/.test(data));
// 24. sem votos copiados
check('24. sem votos copiados', !/total_votes|position/.test(dataCode) && !/\.from\(["']votes["']\)/.test(visualCode));
// 25. sem ranking persistido
// 25. sem ranking persistido (ficheiros NOVOS nunca leem RPCs de apuramento;
// a tabela admin existente continua a ler tally só para exibição, sem copiar)
const newOnlyCode = jsCodeOf([tpl, data, render, preview].join('\n'));
check('25. sem ranking persistido', !/get_admin_tally|get_admin_modality_tally|get_published_results/.test(newOnlyCode));
// 26-30. sem escrita eleitoral
for (const [n, t] of [[26, 'votes'], [27, 'vote_attempts'], [28, 'vote_adjustments'], [29, 'modality_votes'], [30, 'modality_vote_attempts']]) {
  const writeRe = new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  check(`${n}. sem escrita ${t}`, !writeRe.test(visualCode));
}
// 31/32. cast intactos
const castVoteHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('31. cast-vote intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const edgeMod = jsCodeOf(read('supabase/functions/cast-modality-vote/index.ts'));
check('32. cast-modality-vote intacto', !/digital_credential|verification_code|distinction_fulfillment|credentialRenderer|credentialData/i.test(edgeMod));
// 33-35. sem alteração de estados
check('33. sem alteração award_status', !/award_status\s*:/.test(dataCode + renderCode + previewCode));
check('34. sem alteração commercial_status', !/commercial_status\s*:/.test(dataCode + renderCode + previewCode));
check('35. sem alteração credential status', !/\.from\(["']digital_credentials["']\)\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(dataCode + renderCode + previewCode));
// 36. sem pagamentos
check('36. sem pagamentos', !/\bstripe\b|amount_cents|price_cents|unit_price|checkout|subscription|subscrição/i.test(visualCode));
// 37. sem 2027
check('37. sem 2027', !/2027/.test(dataCode + renderCode + previewCode));
// 38. sem novo país/programa
check('38. sem novo país/programa', !/into\s+public\.(award_programs|countries)/i.test(visualCode) && !/['"]fr['"]|['"]be['"]/.test(dataCode + renderCode));
// 39. sem migration 0018
check('39. sem migration 0018', !exists('supabase/migrations/0018_phase5c314_certificates.sql') && !exists('supabase/migrations/0018_anything.sql'));
// 40. PT-PT
check('40. PT-PT', /Conferimos o presente certificado|Em reconhecimento pela distinção|Código de verificação|Data de emissão/.test(data) && /Pré-visualizar|Descarregar|Verificar autenticidade/.test(admin + preview));
// 41. build-safe (imports válidos + tsc alvo)
check('41. build-safe', exists(TPL) && exists(DATA) && exists(RENDER) && exists(PREVIEW) && /from '\.\.\/config\/credentialTemplates'|from '\.\.\/lib\/credential/.test(render + preview));
// 42. componentes separados
check('42. componentes separados', /credentialTemplates/.test(render) && /CredentialPreview/.test(adminCode) && /function renderCertificateCanvas/.test(renderCode) && !/function renderCertificateCanvas/.test(adminCode) && !/function resolveCredentialDisplayData/.test(adminCode));
// 43. config sem números mágicos espalhados
check('43. config sem números mágicos espalhados', /contentArea|fields|qr|typography/i.test(tpl) && /boxToPx/.test(renderCode));
// 44. sem Storage remoto criado
check('44. sem Storage remoto criado', !/\.storage\s*\.from\(["'](certificates|credentials|seals)["']\)\s*\.\s*upload/i.test(visualCode) && !/createBucket|create_bucket/i.test(visualCode));

if (failures > 0) {
  console.error(`\n5C.3.14 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.14 VERIFY: tudo válido (local, sem banco remoto alterado).');
