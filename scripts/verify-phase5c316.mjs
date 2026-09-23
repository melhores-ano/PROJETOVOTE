/**
 * FASE 5C.3.16 — Verificação LOCAL (SEM tocar no banco remoto).
 * Artes oficiais The Best Europa instaladas e usadas byte-a-byte:
 * certificado A4 landscape sem deformação (cover), selo com transparência
 * preservada (contain), selo limpo + verificável, QR só-URL-pública sem IDs
 * internos, placeholder preservado como fail-safe, flag placeholder/official,
 * PT-PT, nomes longos, acentos, revoked bloqueado, VerifyPage autoridade,
 * sem votos/ranking/pagamentos/storage, sem migration 0018, sem 2027, sem
 * novo país/programa, config centralizada, sem reconstrução falsa da arte,
 * cast-vote + cast-modality-vote intactos, build-safe.
 * Uso: node scripts/verify-phase5c316.mjs
 * NÃO executa migration, NÃO faz deploy, NÃO altera banco remoto.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
function readBin(p) { return readFileSync(join(root, p)); }
function jsCodeOf(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Lê dimensões + tipo de cor do IHDR de um PNG (sem dependências). */
function pngInfo(buf) {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return { ok: false };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);
  return { ok: true, width, height, colorType };
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
const CERT_PNG = 'public/brand/credentials/certificate-background.png';
const SEAL_PNG = 'public/brand/credentials/seal-background.png';
const README = 'public/brand/credentials/README.md';

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
const credlib = exists(CREDLIB) ? read(CREDLIB) : '';
const pkg = exists(PKG) ? read(PKG) : '';
const visualScope = [tpl, assets, data, render, preview, admin].join('\n');
const visualCode = jsCodeOf(visualScope);

// 1. certificate-background.png instalado (existe, não vazio, PNG válido 1754×1241)
{
  let ok = false; let detail = '';
  try {
    const buf = readBin(CERT_PNG);
    const info = pngInfo(buf);
    ok = info.ok && info.width === 1754 && info.height === 1241 && buf.length > 100000;
    detail = info.ok ? `${info.width}x${info.height}, ${(buf.length / 1024).toFixed(0)}KB` : 'PNG inválido';
  } catch (e) { detail = String(e.message ?? e); }
  check('1. certificate-background.png instalado', ok, detail);
}
// 2. seal-background.png instalado (existe, não vazio, PNG 1254×1254 com alfa)
{
  let ok = false; let detail = '';
  try {
    const buf = readBin(SEAL_PNG);
    const info = pngInfo(buf);
    const hasAlpha = info.ok && (info.colorType === 6 || info.colorType === 4);
    ok = info.ok && info.width === 1254 && info.height === 1254 && hasAlpha && buf.length > 100000;
    detail = info.ok ? `${info.width}x${info.height}, colorType=${info.colorType}, ${(buf.length / 1024).toFixed(0)}KB` : 'PNG inválido';
  } catch (e) { detail = String(e.message ?? e); }
  check('2. seal-background.png instalado (com transparência)', ok, detail);
}
// 3. certificado referenciado/usado (config + renderer + assets)
check('3. certificado instalado e usado', /certificate-background\.png/.test(tpl) && /CREDENTIAL_ASSETS\.certificateBackground|CERTIFICATE_TEMPLATE\.backgroundPath/.test(render) && /DEFINITIVE_CERTIFICATE_PATH/.test(assets));
// 4. selo referenciado/usado
check('4. selo instalado e usado', /seal-background\.png/.test(tpl) && /SEAL_CLEAN_TEMPLATE|SEAL_VERIFIABLE_TEMPLATE/.test(tpl) && /DEFINITIVE_SEAL_PATH/.test(assets));
// 5. certificate status = official
check('5. certificate status = official', /CREDENTIAL_ASSET_STATUS/.test(tpl) && /certificate:\s*['"]official['"]/.test(tpl));
// 6. seal status = official
check('6. seal status = official', /CREDENTIAL_ASSET_STATUS/.test(tpl) && /seal:\s*['"]official['"]/.test(tpl));
// 7. certificado sem deformação (cover; crop preferido a deformação)
check('7. certificado sem deformação (cover)', /backgroundFit:\s*['"]cover['"]/.test(tpl) && /drawImageCover/.test(renderCode) && /SEM deformar|sem deformação|Crop.*preferido a deformação|pequeno crop/i.test(render + tpl));
// 8. selo mantém transparência (contain + clearRect + transparent, nunca fundo branco)
{
  const hasContain = /backgroundFit:\s*['"]contain['"]/.test(tpl) && /drawImageContain/.test(renderCode);
  const hasClear = /clearRect/.test(renderCode);
  const transparent = /transparent:\s*true/.test(tpl);
  const noWhiteFill = !/fillStyle\s*=\s*['"]#ffffff['"]\s*;\s*\n\s*ctx\.fillRect\(0,\s*0,\s*w,\s*h\)/.test(renderCode);
  check('8. selo mantém transparência', hasContain && hasClear && transparent && noWhiteFill);
}
// 9. selo limpo (arte pura, sem QR/texto sobreposto)
check('9. selo limpo', /SEAL_CLEAN_TEMPLATE/.test(tpl + render + preview) && /Selo limpo/.test(preview) && /variant.*clean|'clean'/.test(render + preview));
// 10. selo verificável (QR + código + micro-legenda discretos)
check('10. selo verificável', /SEAL_VERIFIABLE_TEMPLATE/.test(tpl + render) && /Selo verificável|verificável/.test(preview + render) && /qrCaption/.test(tpl));
// 11. QR público (aponta /verificar via URL absoluta)
check('11. QR público', /buildVerifyQrDataUrl|toDataURL/.test(render) && /verificar/.test(render) && /absoluteVerifyUrl|verifyPath/.test(renderCode));
// 12. QR sem IDs internos
check('12. QR sem IDs internos', /sem IDs internos|SOMENTE.*URL pública/i.test(render) && !/business_id|distinction_id/.test(renderCode));
// 13. placeholder preservado como fail-safe
check('13. placeholder preservado (fail-safe)', /paintCertificatePlaceholder|paintSealPlaceholder/.test(renderCode) && /placeholder/i.test(tpl + render));
// 14. A4 landscape
check('14. A4 landscape', /A4/.test(tpl) && /landscape/.test(tpl + render) && /3508/.test(tpl) && /2480/.test(tpl));
// 15. texto PT-PT
check('15. texto PT-PT', /Conferimos o presente certificado|Em reconhecimento pelo mérito|Código de verificação|Data de emissão/.test(data) && /Verificar autenticidade/.test(tpl + render + preview));
// 16. empresa dinâmica
check('16. empresa dinâmica', /businessName/.test(data) && /recipientName/.test(data));
// 17. programa dinâmico
check('17. programa dinâmico', /programName/.test(data) && !/hardcode.*UUID|00000000-0000/i.test(dataCode));
// 18. ano dinâmico
check('18. ano dinâmico', /campaignYear|Edição/.test(data));
// 19. cidade dinâmica
check('19. cidade dinâmica', /cityName/.test(data));
// 20. categoria dinâmica
check('20. categoria dinâmica', /categoryName/.test(data));
// 21. modalidade opcional
check('21. modalidade opcional', /modalityName/.test(data) && /Quando modalidade|omite modalidade|sem deixar|sem espaço|modalidade.*opcional|opcional/i.test(data + tpl + render));
// 22. data emissão + verification code
check('22. data emissão + verification code', /issuedAt|issued_at/.test(data) && /Data de emissão/.test(data) && /verificationCode|verification_code/.test(data) && /Código de verificação/.test(data));
// 23. nome longo protegido
check('23. nome longo protegido', /drawAutoFit|minSizePxAt300dpi|maxLines|clampDisplayName|redução automática/i.test(tpl + data + render));
// 24. acentos suportados
check('24. acentos suportados', /Georgia/.test(tpl) && /Á|É|acentos PT/i.test(tpl + render));
// 25. preview certificado + selo (botões admin + canvas)
check('25. preview certificado', /Pré-visualizar certificado/.test(admin + preview) && /aspect-\[297\/210\]|landscape/i.test(preview));
check('26. preview selo', /Pré-visualizar selo/.test(admin + preview) && /aspect-square|quadrado/i.test(preview));
// 27. PDF A4 (jsPDF)
check('27. PDF A4', /downloadCertificatePdf/.test(render + preview) && /jsPDF/.test(render) && /jspdf/.test(pkg));
// 28. revoked bloqueado
check('28. revoked bloqueado', /REVOGADO/.test(admin + preview + render) && /bloquead/i.test(admin + preview + render));
// 29. VerifyPage continua autoridade
check('29. VerifyPage autoridade', /verify_digital_credential/.test(credlib) && /Credencial autêntica|Credencial revogada|Código não encontrado/.test(verify));
// 30. sem votos copiados
check('30. sem votos', !/\.from\(["']votes["']\)/.test(visualCode) && !/total_votes/.test(dataCode));
// 31. sem ranking persistido (ficheiros novos nunca leem RPCs de apuramento)
{
  const newOnlyCode = jsCodeOf([tpl, assets, data, render, preview].join('\n'));
  check('31. sem ranking', !/get_admin_tally|get_admin_modality_tally|get_published_results/.test(newOnlyCode));
}
// 32. sem writes eleitorais
{
  const tables = ['votes', 'vote_attempts', 'vote_adjustments', 'modality_votes', 'modality_vote_attempts'];
  const hit = tables.filter((t) => new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i').test(visualCode));
  check('32. sem writes eleitorais', hit.length === 0, hit.join(','));
}
// 33. cast-vote intacto (hash SHA256)
{
  let ok = false; let h = '';
  try { h = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase(); ok = h === EXPECTED_CAST_VOTE; } catch { ok = false; }
  check('33. cast-vote intacto', ok, h);
}
// 34. cast-modality-vote intacto
{
  const edgeMod = jsCodeOf(read('supabase/functions/cast-modality-vote/index.ts'));
  check('34. cast-modality-vote intacto', !/digital_credential|verification_code|distinction_fulfillment|credentialRenderer|credentialData/i.test(edgeMod));
}
// 35-37. sem alteração de estados (award/commercial/credential)
check('35. sem alteração award_status', !/award_status\s*:/.test(dataCode + renderCode + previewCode));
check('36. sem alteração commercial_status', !/commercial_status\s*:/.test(dataCode + renderCode + previewCode));
check('37. sem alteração credential status', !/\.from\(["']digital_credentials["']\)\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(dataCode + renderCode + previewCode));
// 38. sem pagamentos
check('38. sem pagamentos', !/\bstripe\b|amount_cents|price_cents|unit_price|checkout|subscription|subscrição/i.test(visualCode));
// 39. sem storage remoto novo
check('39. sem storage', !/\.storage\s*\.from\(["'](certificates|credentials|seals)["']\)\s*\.\s*upload/i.test(visualCode) && !/createBucket|create_bucket/i.test(visualCode));
// 40. nenhuma migration 0018
{
  let no0018 = true;
  try {
    const files = readdirSync(join(root, 'supabase/migrations'));
    no0018 = !files.some((f) => /^0018/i.test(f));
  } catch { no0018 = false; }
  check('40. nenhuma migration 0018', no0018);
}
// 41. sem 2027
check('41. sem 2027', !/2027/.test(dataCode + renderCode + previewCode + jsCodeOf(tpl)));
// 42. sem novo país/programa
check('42. sem novo país/programa', !/into\s+public\.(award_programs|countries)/i.test(visualCode) && !/['"]fr['"]|['"]be['"]/.test(dataCode + renderCode));
// 43. config centralizada (sem números mágicos espalhados)
check('43. config centralizada', /contentArea|safeArea|fields|qr|typography|margins/i.test(tpl) && /boxToPx/.test(renderCode) && /credentialTemplates/.test(render + assets));
// 44. sem reconstrução falsa da arte
check('44. sem reconstrução falsa da arte', /NÃO.*reconstruir|Não.*redesenhar|NÃO criar imitação|NÃO criar novo logótipo|Nunca redesenha/i.test(tpl + render) && /ARTE OFICIAL PENDENTE|Artes oficiais instaladas/i.test(exists(README) ? read(README) : ''));
// 45. build-safe (ficheiros + deps)
check('45. build-safe', exists(TPL) && exists(ASSETS) && exists(DATA) && exists(RENDER) && exists(PREVIEW) && /qrcode/.test(pkg) && /jspdf/.test(pkg));
// 46. este script não toca no banco remoto (só leitura local: read/exists/readdir)
{
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const selfCode = jsCodeOf(self);
  // Nota: comparações por concatenação para o teste não coincidir consigo próprio.
  const hasDbClient =
    selfCode.includes('create' + 'Client(') ||
    selfCode.includes('supabase' + '-js') ||
    selfCode.includes('apply' + '-migrations') ||
    selfCode.includes('supabase' + '.from(') ||
    selfCode.includes('supabase' + '.rpc(');
  const writesFiles =
    selfCode.includes('write' + 'FileSync') ||
    selfCode.includes('append' + 'FileSync') ||
    selfCode.includes('copy' + 'FileSync') ||
    selfCode.includes('mkdir' + 'Sync') ||
    selfCode.includes('rm' + 'Sync');
  void statSync;
  check('46. nenhum banco remoto alterado', !hasDbClient && !writesFiles);
}

if (failures > 0) {
  console.error(`\n5C.3.16 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.16 VERIFY: tudo válido (local, sem banco remoto alterado).');
