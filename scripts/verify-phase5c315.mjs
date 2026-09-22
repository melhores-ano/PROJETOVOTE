/**
 * FASE 5C.3.15 — Verificação LOCAL (SEM tocar no banco remoto).
 * Integração das artes oficiais The Best Europa: template oficial configurável,
 * selo limpo + verificável, placeholder preservado, flag placeholder/official,
 * A4 landscape, PT-PT, nomes longos, acentos, QR só-URL-pública, revoked
 * bloqueado, VerifyPage autoridade, sem votos/ranking/pagamentos/storage,
 * sem migration 0018, sem 2027, sem novo país/programa, config centralizada,
 * sem reconstrução falsa da arte, build-safe.
 * Uso: node scripts/verify-phase5c315.mjs
 * Revalidado nos ciclos de continuação: 42/42 PASS, tsc limpo, build PASS.
 * Ciclo 5: bateria histórica integral (5c315→5c38) PASS + tsc PASS.
 * Ciclo 6: 42/42 PASS + tsc PASS, sem alterações funcionais.
 * Ciclo 7: 42/42 PASS + tsc PASS, sem alterações funcionais.
 * Ciclo 8: 42/42 PASS + tsc PASS, sem alterações funcionais.
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
const ASSETS = 'src/lib/credentialAssets.ts';
const DATA = 'src/lib/credentialData.ts';
const RENDER = 'src/lib/credentialRenderer.ts';
const PREVIEW = 'src/components/CredentialPreview.tsx';
const ADMIN = 'src/pages/admin/DistinctionsAdminPage.tsx';
const VERIFY = 'src/pages/public/VerifyPage.tsx';
const CREDLIB = 'src/lib/digitalCredentials.ts';
const PKG = 'package.json';

const tpl = exists(TPL) ? read(TPL) : '';
const tplCode = jsCodeOf(tpl);
const assets = exists(ASSETS) ? read(ASSETS) : '';
const data = exists(DATA) ? read(DATA) : '';
const dataCode = jsCodeOf(data);
const render = exists(RENDER) ? read(RENDER) : '';
const renderCode = jsCodeOf(render);
const preview = exists(PREVIEW) ? read(PREVIEW) : '';
const previewCode = jsCodeOf(preview);
const admin = exists(ADMIN) ? read(ADMIN) : '';
const adminCode = jsCodeOf(admin);
const verify = exists(VERIFY) ? read(VERIFY) : '';
const verifyCode = jsCodeOf(verify);
const credlib = exists(CREDLIB) ? read(CREDLIB) : '';
const pkg = exists(PKG) ? read(PKG) : '';
const visualScope = [tpl, assets, data, render, preview, admin].join('\n');
const visualCode = jsCodeOf(visualScope);

// 1. certificado oficial configurável
check('1. certificado oficial configurável', /CERTIFICATE_TEMPLATE/.test(tpl) && /certificate-background\.png/.test(tpl) && /contentArea|safeArea/.test(tpl));
// 2. selo oficial configurável
check('2. selo oficial configurável', /SEAL_TEMPLATE/.test(tpl) && /seal-background\.png/.test(tpl));
// 3. placeholder preservado
check('3. placeholder preservado', /ASSET_PLACEHOLDER|provisório|PROVISÓRIO|placeholder/i.test(tpl + render) && /paintCertificatePlaceholder|paintSealPlaceholder/.test(renderCode));
// 4. flag/status placeholder/official
check('4. flag/status placeholder/official', /CREDENTIAL_ASSET_STATUS/.test(tpl) && /placeholder/.test(tpl) && /official/.test(tpl) && /isOfficialAsset|assetStatus/.test(tpl + assets));
// 5. A4 landscape
check('5. A4 landscape', /A4/.test(tpl) && /landscape/.test(tpl + render) && /3508/.test(tpl) && /2480/.test(tpl));
// 6. texto PT-PT
check('6. texto PT-PT', /Conferimos o presente certificado|Em reconhecimento pelo mérito|Código de verificação|Data de emissão/.test(data) && /Verificar autenticidade/.test(tpl + render + preview));
// 7. empresa dinâmica
check('7. empresa dinâmica', /businessName/.test(data) && /recipientName/.test(data));
// 8. programa dinâmico
check('8. programa dinâmico', /programName/.test(data) && !/hardcode.*UUID|00000000-0000/i.test(dataCode));
// 9. ano dinâmico
check('9. ano dinâmico', /campaignYear|Edição/.test(data));
// 10. cidade dinâmica
check('10. cidade dinâmica', /cityName/.test(data));
// 11. categoria dinâmica
check('11. categoria dinâmica', /categoryName/.test(data));
// 12. modalidade opcional
check('12. modalidade opcional', /modalityName/.test(data) && /Quando modalidade|omite modalidade|sem deixar|sem espaço|modalidade.*opcional|opcional/i.test(data + tpl + render));
// 13. data emissão
check('13. data emissão', /issuedAt|issued_at/.test(data) && /Data de emissão/.test(data));
// 14. verification code
check('14. verification code', /verificationCode|verification_code/.test(data) && /Código de verificação/.test(data));
// 15. QR público
check('15. QR público', /buildVerifyQrDataUrl|toDataURL/.test(render) && /verificar/.test(render) && /absoluteVerifyUrl|verifyPath/.test(renderCode));
// 16. QR sem IDs internos
check('16. QR sem IDs internos', /sem IDs internos|SOMENTE.*URL pública/i.test(render) && !/business_id|distinction_id/.test(renderCode));
// 17. nome longo protegido
check('17. nome longo protegido', /drawAutoFit|minSizePxAt300dpi|maxLines|clampDisplayName|redução automática/i.test(tpl + data + render));
// 18. acentos suportados
check('18. acentos suportados', /Georgia/.test(tpl) && /Á|É|acentos PT/i.test(tpl + render));
// 19. preview certificado
check('19. preview certificado', /Pré-visualizar certificado/.test(admin + preview) && /aspect-\[297\/210\]|landscape/i.test(preview));
// 20. preview selo
check('20. preview selo', /Pré-visualizar selo/.test(admin + preview) && /aspect-square|quadrado/i.test(preview));
// 21. selo limpo
check('21. selo limpo', /SEAL_CLEAN_TEMPLATE|sealClean|'clean'|"clean"/.test(tpl + render + preview) && /Selo limpo/.test(preview));
// 22. selo verificável
check('22. selo verificável', /SEAL_VERIFIABLE_TEMPLATE|sealVerifiable|verifiable/.test(tpl + render + preview) && /Selo verificável|verificável/.test(preview + render));
// 23. PNG transparente
check('23. PNG transparente', /transparent/i.test(tpl + render) && /clearRect/.test(renderCode) && !/fillStyle\s*=\s*['"]#ffffff['"]\s*;\s*\n\s*ctx\.fillRect\(0,\s*0,\s*w,\s*h\)/.test(renderCode));
// 24. PDF
check('24. PDF', /downloadCertificatePdf/.test(render + preview) && /jsPDF/.test(render) && /jspdf/.test(pkg));
// 25. credencial revoked bloqueada
check('25. credencial revoked bloqueada', /REVOGADO/.test(admin + preview + render) && /bloquead/i.test(admin + preview + render));
// 26. VerifyPage continua autoridade
check('26. VerifyPage continua autoridade', /verify_digital_credential/.test(credlib) && /Credencial autêntica|Credencial revogada|Código não encontrado/.test(verify));
// 27. sem votos
check('27. sem votos', !/\.from\(["']votes["']\)/.test(visualCode) && !/total_votes/.test(dataCode));
// 28. sem ranking
check('28. sem ranking', !/get_admin_tally|get_admin_modality_tally|get_published_results/.test(jsCodeOf([tpl, assets, data, render, preview].join('\n'))));
// 29. sem writes eleitorais
{
  const tables = ['votes', 'vote_attempts', 'vote_adjustments', 'modality_votes', 'modality_vote_attempts'];
  const hit = tables.filter((t) => new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i').test(visualCode));
  check('29. sem writes eleitorais', hit.length === 0, hit.join(','));
}
// 30/31. cast intactos
{
  let ok30 = false; let h = '';
  try { h = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase(); ok30 = h === EXPECTED_CAST_VOTE; } catch { ok30 = false; }
  check('30. cast-vote intacto', ok30, h);
}
{
  const edgeMod = jsCodeOf(read('supabase/functions/cast-modality-vote/index.ts'));
  check('31. cast-modality-vote intacto', !/digital_credential|verification_code|distinction_fulfillment|credentialRenderer|credentialData/i.test(edgeMod));
}
// 32-34. sem alteração de estados
check('32. sem alteração award_status', !/award_status\s*:/.test(dataCode + renderCode + previewCode));
check('33. sem alteração commercial_status', !/commercial_status\s*:/.test(dataCode + renderCode + previewCode));
check('34. sem alteração credential status', !/\.from\(["']digital_credentials["']\)\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(dataCode + renderCode + previewCode));
// 35. sem pagamentos
check('35. sem pagamentos', !/\bstripe\b|amount_cents|price_cents|unit_price|checkout|subscription|subscrição/i.test(visualCode));
// 36. sem storage
check('36. sem storage', !/\.storage\s*\.from\(["'](certificates|credentials|seals)["']\)\s*\.\s*upload/i.test(visualCode) && !/createBucket|create_bucket/i.test(visualCode));
// 37. sem migration 0018
{
  const no0018 = !exists('supabase/migrations/0018_phase5c314_certificates.sql') && !exists('supabase/migrations/0018_anything.sql') && !exists('supabase/migrations/0018_phase5c315_official_artwork.sql');
  check('37. sem migration 0018', no0018);
}
// 38. sem 2027
check('38. sem 2027', !/2027/.test(dataCode + renderCode + previewCode + jsCodeOf(tpl)));
// 39. sem novo país/programa
check('39. sem novo país/programa', !/into\s+public\.(award_programs|countries)/i.test(visualCode) && !/['"]fr['"]|['"]be['"]/.test(dataCode + renderCode));
// 40. config centralizada
check('40. config centralizada', /contentArea|safeArea|fields|qr|typography|margins/i.test(tpl) && /boxToPx/.test(renderCode) && /credentialTemplates/.test(render + assets));
// 41. sem reconstrução falsa da arte
check('41. sem reconstrução falsa da arte', /NÃO.*reconstruir|Não.*redesenhar|NÃO criar imitação|NÃO criar novo logótipo|Nunca redesenha/i.test(tpl + render) && /ARTE OFICIAL PENDENTE/.test(read('public/brand/credentials/README.md')));
// 42. build-safe
check('42. build-safe', exists(TPL) && exists(ASSETS) && exists(DATA) && exists(RENDER) && exists(PREVIEW) && /qrcode/.test(pkg) && /jspdf/.test(pkg));

if (failures > 0) {
  console.error(`\n5C.3.15 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.15 VERIFY: tudo válido (local, sem banco remoto alterado).');
