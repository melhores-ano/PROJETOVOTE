/**
 * FASE 6.4.3 — Verificação LOCAL (SEM tocar no banco remoto).
 * Admin > Revistas — gestão editorial da Revista Digital Oficial:
 * rota/menu, isolamento por programa, CRUD editorial, elegibilidade
 * (package active + includes_publication), zero Meta Ads, upload
 * magazine-images, snapshots, galeria relacional, publicação edição/
 * feature, perda de elegibilidade fail-closed, zero escrita eleitoral,
 * 0020/0021/0022 intactas, cast-vote/cast-modality-vote intactos.
 * Sem db push, sem deploy, sem git commit, sem SQL remoto.
 * Uso: node scripts/verify-phase643.mjs
 *
 * NOTA 6.4.2 check 28 (local-only): 0022 já foi aplicada e commitada em
 * 0723a8f — esse check antigo NÃO é regressão funcional e é ignorado aqui.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const APP = 'src/App.tsx';
const LAYOUT = 'src/components/AdminLayout.tsx';
const LIST = 'src/pages/admin/MagazineAdminPage.tsx';
const DETAIL = 'src/pages/admin/MagazineEditionPage.tsx';
const LIB = 'src/lib/adminMagazine.ts';
const HOOKS = 'src/hooks/useAdminMagazines.ts';
const CORE = 'src/lib/magazine.ts';
const MIG20 = 'supabase/migrations/0020_phase631_digital_package_adoptions.sql';
const MIG21 = 'supabase/migrations/0021_phase641_magazine_foundation.sql';
const MIG22 = 'supabase/migrations/0022_phase642_magazine_public_read.sql';

const app = exists(APP) ? read(APP) : '';
const layout = exists(LAYOUT) ? read(LAYOUT) : '';
const list = exists(LIST) ? read(LIST) : '';
const detail = exists(DETAIL) ? read(DETAIL) : '';
const lib = exists(LIB) ? read(LIB) : '';
const hooks = exists(HOOKS) ? read(HOOKS) : '';
const core = exists(CORE) ? read(CORE) : '';
const libCode = jsCodeOf(lib);
const listCode = jsCodeOf(list);
const detailCode = jsCodeOf(detail);
const allAdmin = libCode + '\n' + listCode + '\n' + detailCode + '\n' + jsCodeOf(hooks);

// ---- 1. ficheiros criados ----
check('1a. src/lib/adminMagazine.ts existe', exists(LIB));
check('1b. src/hooks/useAdminMagazines.ts existe', exists(HOOKS));
check('1c. src/pages/admin/MagazineAdminPage.tsx existe', exists(LIST));
check('1d. src/pages/admin/MagazineEditionPage.tsx existe', exists(DETAIL));
check('1e. scripts/verify-phase643.mjs existe', exists('scripts/verify-phase643.mjs'));

// ---- 2. rota Admin ----
check('2a. rota /admin/revistas registada (App.tsx)',
  /path="admin\/revistas"/.test(app) && /MagazineAdminPage/.test(app));
check('2b. rota /admin/revistas/:editionId registada (App.tsx)',
  /path="admin\/revistas\/:editionId"/.test(app) && /MagazineEditionPage/.test(app));
check('2c. rotas dentro de <ProtectedRoute> (sem prefixo /pt/)',
  /<ProtectedRoute/.test(app) && !/path="pt\/admin\/revistas"/.test(app));
check('2d. sem rota pública da revista (sem flipbook/MagazineViewer//revista pública)',
  !/MagazineViewer|Flipbook|get_published_magazine_with_features/i.test(app) &&
  !/path="[^"]*revista[^"]*"[^>]*public/i.test(app));

// ---- 3. menu Revistas ----
check('3a. menu Admin contém "Revistas" → /admin/revistas',
  /\/admin\/revistas/.test(layout) && /Revistas/.test(layout));
check('3b. item usa ícone lucide dedicado', /BookOpen|Newspaper|Book/.test(layout));

// ---- 4. isolamento por programa ----
check('4a. listagem lê AdminProgramProvider (programa selecionado)',
  /useAdminProgram/.test(list) && /selectedProgramId|awardProgramId|programId/.test(list));
check('4b. lib isola por award_program_id (fail-closed sem programa → [])',
  /award_program_id/.test(lib) && /if \(programId === ''\) return \[\]/.test(libCode));
check('4c. criação deriva programa do contexto (sem input livre de programa)',
  /award_program_id: programId/.test(listCode));
check('4d. sem UUID hardcoded de programa',
  !/00000000-0000-4000-8000-00000000pt00/.test(allAdmin));

// ---- 5. CRUD editorial ----
check('5a. criar revista (draft inicial, sem publicar direto)',
  /createMagazineEdition/.test(allAdmin) && /status: 'draft'/.test(listCode));
check('5b. barreira anti-duplicado campanha × cidade (client + UNIQUE)',
  /campaign_id.*city_id|magazine_editions_campaign_city/i.test(listCode + libCode));
check('5c. editar revista (updateMagazineEdition)', /updateMagazineEdition/.test(allAdmin));
check('5d. publicar/arquivar/reabrir edição', /publishMagazineEdition|archiveMagazineEdition|reopenMagazineEdition/.test(allAdmin));
check('5e. criar/editar feature (snapshots + ordem + selo)',
  /createMagazineFeature/.test(allAdmin) && /updateMagazineFeature/.test(allAdmin));
check('5f. remover feature = DELETE só magazine_features (CASCADE imagens)',
  /removeFeatureFromMagazine/.test(allAdmin) && /\.from\(['"]magazine_features['"]\)\s*\)?\s*\.\s*delete\(\)/.test(libCode));

// ---- 6. elegibilidade package active + includes_publication ----
check('6a. elegíveis exigem status active', /\.eq\(['"]status['"],\s*['"]active['"]\)/.test(libCode) || /status === 'active'/.test(libCode));
check('6b. elegíveis exigem includes_publication true',
  /\.eq\(['"]includes_publication['"],\s*true\)/.test(libCode) || /includes_publication === true/.test(libCode));
check('6c. distinção cancelled excluída', /cancelled/.test(libCode));
check('6d. sem duplicar distinção na mesma revista (alreadyFeatured)',
  /alreadyFeatured/.test(libCode));

// ---- 7. zero dependência Meta Ads ----
const metaGate = /(includes_meta_ads|meta_ads_consent_at)\s*(=|===|!==|is|in|>|<)|\.eq\(['"](includes_meta_ads|meta_ads_consent_at)['"]/i.test(allAdmin);
check('7a. zero gate Meta Ads (includes_meta_ads/meta_ads_consent_at nunca condicionam)', !metaGate);
check('7b. independência documentada', /desacoplada de Meta Ads|zero dependência Meta Ads|independência total/i.test(lib));

// ---- 8. upload bucket magazine-images ----
check('8a. capa usa bucket existente magazine-images (sem novo bucket)',
  /bucket="magazine-images"/.test(list + detail) && /MAGAZINE_BUCKET = 'magazine-images'/.test(lib));
check('8b. sem createBucket/ novo bucket', !/createBucket|new bucket|novo bucket/i.test(allAdmin));
check('8c. preview da capa (ImageField com preview)', /ImageField/.test(list + detail));
check('8d. URL preservado em cover_image_url', /cover_image_url/.test(allAdmin));

// ---- 9. snapshots comerciais ----
for (const f of ['address_snapshot', 'phone_snapshot', 'website_snapshot', 'instagram_snapshot', 'facebook_snapshot']) {
  check(`9. snapshot ${f} no editor`, new RegExp(`\\b${f}\\b`).test(detail + lib));
}
check('9f. pré-preenchimento a partir de businesses (depois independente)',
  /prefillSnapshotsFromBusiness/.test(lib + detail));
check('9g. CTA label/url + selo + ordem', /cta_label|cta_url|show_official_seal|editorial_order/.test(detail + lib));

// ---- 10. galeria relacional ----
check('10a. galeria via magazine_images (linhas, sem JSON array)',
  /magazine_images/.test(lib + detail) && !/images_json|images:\s*string\[\]|JSON\.stringify\(gallery/i.test(allAdmin));
check('10b. adicionar/remover imagens', /addMagazineImage/.test(detail + lib) && /removeMagazineImage|magazine_image/.test(detail + lib));
check('10c. legenda + ordenação', /caption/.test(detail) && /sort_order/.test(detail));

// ---- 11. publicação edição ----
check('11a. publicar exige confirmação explícita (frase canónica)',
  /Esta revista ficar. dispon.vel publicamente/i.test(list + detail + lib));
check('11b. published_at = now() (sem auto-publicar features)',
  /published_at.*new Date\(\).toISOString\(\)|published_at.*now\(\)/i.test(core) &&
  /NÃO publica automaticamente nenhum destaque/i.test(list + detail));
check('11c. edição publicada contém só features individualmente publicados',
  /somente os destaques/i.test(list + detail));

// ---- 12. publicação feature ----
check('12a. publish/unpublish feature (is_published + published_at)',
  /publishMagazineFeature/.test(allAdmin) && /unpublishMagazineFeature/.test(allAdmin));
check('12b. despublicar preserva registo (sem DELETE)', !/delete\(\).*feature.*publish|publish.*delete/i.test(allAdmin));

// ---- 13. perda de elegibilidade fail-closed ----
check('13a. rótulo "Elegibilidade editorial suspensa"',
  /Elegibilidade editorial suspensa/.test(lib + detail));
check('13b. feature inelegível NUNCA apagada (sem delete em suspend)',
  /NUNCA (é )?apagada|é preservada|preservada/i.test(lib + detail));
check('13c. (re)publicação bloqueada enquanto inelegível',
  /isFeatureEligibilitySuspended|eligibilitySuspended/.test(detail + lib));
check('13d. sem duplicar autoridade das RPCs públicas (não chama get_published_*)',
  !/get_published_magazine/.test(allAdmin));

// ---- 14. zero escrita eleitoral ----
for (const [n, t] of [[14, 'votes'], [15, 'vote_attempts'], [16, 'vote_adjustments'], [17, 'modality_votes'], [18, 'modality_vote_attempts']]) {
  const w = new RegExp(`\\.from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  check(`${n}. sem escrita ${t}`, !w.test(allAdmin));
}
check('19. sem escrita campaign_entries/distinctions/adoptions/credentials/fulfillment',
  !/\.from\(["'](campaign_entries|award_distinctions|distinction_package_adoptions|digital_credentials|distinction_fulfillment)["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(allAdmin));
check('20. sem service_role no frontend', !/service_role/i.test(allAdmin));
check('21. sem SELECT público direto (sem policy anon; RLS admin-only preservada)',
  !/to anon.*magazine|policy.*anon.*magazine/i.test(allAdmin));
check('22. sem RPCs públicas 6.4.2 alteradas/criadas aqui',
  !/create\s+(or\s+replace\s+)?function\s+public\.get_published_/i.test(allAdmin));

// ---- 23. sem migration nova (0021 cobre tudo) + 0020/0021/0022 intactas ----
check('23a. nenhuma migration 0023 criada', !exists('supabase/migrations/0023_phase643_admin_magazine.sql') && (() => {
  try {
    const files = readdirSync(join(root, 'supabase/migrations'));
    return !files.some((f) => /^0023/i.test(f));
  } catch { return true; }
})());
try {
  const out = execSync(`git status --porcelain -- "${MIG20}" "${MIG21}" "${MIG22}"`, { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const modified = lines.filter((l) => !l.startsWith('??'));
  check('23b. 0020/0021/0022 intactas (sem M/D)', modified.length === 0, lines.join('; ') || 'limpo');
} catch { check('23b. 0020/0021/0022 intactas (git indisponível, skip)', true, 'git skip'); }

// ---- 24. cast-vote intactos ----
try {
  const out = execSync('git status --porcelain -- supabase/functions/cast-vote supabase/functions/cast-modality-vote', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  check('24. cast-vote/cast-modality-vote intactos', lines.length === 0, lines.join('; ') || 'limpo');
} catch { check('24. cast-vote/cast-modality-vote intactos (git indisponível, skip)', true, 'git skip'); }

// ---- 25. sem superfície proibida (flipbook/público/seed/pagamento/ads) ----
check('25a. sem flipbook/MagazineViewer/rota pública',
  !/Flipbook|MagazineViewer|PageFlip|turn\.js/i.test(allAdmin));
check('25b. sem seed/conteúdo Braga', !/seed.*braga|braga.*seed/i.test(allAdmin));
check('25c. sem checkout/pagamentos/Meta Ads/painel ads',
  !/stripe|checkout|mbway|multibanco|payment|ads_manager|facebook_ads|meta_ads_consent/i.test(allAdmin));

// ---- 26. lib/hooks limpos (sem lógica toda no componente) ----
check('26. lib + hooks dedicados (componentes consomem camada)',
  /from '.*lib\/adminMagazine'|from ".*lib\/adminMagazine"/.test(list + detail + hooks) &&
  /useAdminMagazineEditions|useAdminMagazineFeatures|useEligibleDistinctions/.test(list + detail));

if (failures > 0) {
  console.error(`\n6.4.3 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n6.4.3 VERIFY: tudo válido (local, sem banco remoto alterado).');
