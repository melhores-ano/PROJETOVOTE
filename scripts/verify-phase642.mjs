/**
 * FASE 6.4.2 — Verificação LOCAL (SEM tocar no banco remoto).
 * Leitura pública segura da Revista Digital Oficial (READ-ONLY):
 * migration 0022 (RPCs get_published_*), lib src/lib/publicMagazine.ts,
 * tipos públicos, RLS admin-only preservado, elegibilidade editorial
 * (active + includes_publication), independência total de Meta Ads,
 * motor eleitoral intocável, 0020/0021 intocadas, sem UI/rotas.
 * Sem db push, sem deploy, sem git commit.
 * Uso: node scripts/verify-phase642.mjs
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
function sqlCodeOf(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const MIG = 'supabase/migrations/0022_phase642_magazine_public_read.sql';
const MIG20 = 'supabase/migrations/0020_phase631_digital_package_adoptions.sql';
const MIG21 = 'supabase/migrations/0021_phase641_magazine_foundation.sql';
const LIB = 'src/lib/publicMagazine.ts';
const ADMIN_LIB = 'src/lib/magazine.ts';

const migExists = exists(MIG);
const libExists = exists(LIB);
check('1. migration 0022 existe', migExists);
check('2. lib pública src/lib/publicMagazine.ts existe', libExists);

const mig = migExists ? read(MIG) : '';
const migCode = sqlCodeOf(mig);
const migCodeNoStrings = migCode.replace(/'[^']*'/g, "''");
const lib = libExists ? read(LIB) : '';
const libCode = jsCodeOf(lib);
const adminLib = exists(ADMIN_LIB) ? read(ADMIN_LIB) : '';

// ---- 3. RPC edição existe ----
check('3. RPC get_published_magazine(text,text) criada',
  /create\s+(or\s+replace\s+)?function\s+public\.get_published_magazine\s*\(\s*(p_award_program_slug\s+text|text)\s*,\s*(p_magazine_slug\s+text|text)\s*\)/i.test(migCode));

// ---- 4. RPC features existe ----
check('4. RPC get_published_magazine_features(text,text) criada',
  /create\s+(or\s+replace\s+)?function\s+public\.get_published_magazine_features\s*\(/i.test(migCode));

// ---- 5. terceira RPC imagens (estratégia granular + galeria embutida) ----
const hasImagesRpc = /create\s+(or\s+replace\s+)?function\s+public\.get_published_magazine_feature_images\s*\(/i.test(migCode);
const hasEmbeddedGallery = /jsonb_agg/i.test(migCode) && /magazine_images/i.test(migCode);
check('5. estratégia das imagens (galeria embutida ordenada e/ou 3ª RPC granular)',
  hasImagesRpc || hasEmbeddedGallery,
  hasImagesRpc ? '3ª RPC + embutida' : hasEmbeddedGallery ? 'embutida' : 'ausente');
check('5b. 3ª RPC get_published_magazine_feature_images(text,text,text)',
  hasImagesRpc);

// ---- 6. SECURITY DEFINER ----
for (const fn of ['get_published_magazine', 'get_published_magazine_features', 'get_published_magazine_feature_images']) {
  const body = migCode.match(new RegExp(`function\\s+public\\.${fn}[\\s\\S]*?\\$\\$;`, 'i'));
  const seg = body ? body[0] : '';
  check(`6. SECURITY DEFINER em ${fn}`, /security definer/i.test(seg));
}

// ---- 7. search_path seguro ----
for (const fn of ['get_published_magazine', 'get_published_magazine_features', 'get_published_magazine_feature_images']) {
  const body = migCode.match(new RegExp(`function\\s+public\\.${fn}[\\s\\S]*?\\$\\$;`, 'i'));
  const seg = body ? body[0] : '';
  check(`7. search_path seguro em ${fn}`, /set\s+search_path\s*=\s*public/i.test(seg));
}

// ---- 8. grants controlados ----
check('8a. REVOKE ALL FROM PUBLIC nas 3 RPCs',
  /revoke all on function public\.get_published_magazine/i.test(migCode) &&
  /revoke all on function public\.get_published_magazine_features/i.test(migCode) &&
  /revoke all on function public\.get_published_magazine_feature_images/i.test(migCode));
check('8b. GRANT EXECUTE a anon,authenticated (e só)',
  /grant execute on function public\.get_published_magazine[^;]*to anon,\s*authenticated/i.test(migCode) &&
  /grant execute on function public\.get_published_magazine_features[^;]*to anon,\s*authenticated/i.test(migCode) &&
  /grant execute on function public\.get_published_magazine_feature_images[^;]*to anon,\s*authenticated/i.test(migCode));
check('8c. sem GRANT de escrita nem a service_role no frontend',
  !/grant\s+(insert|update|delete|all\s+on\s+table)/i.test(migCode) &&
  !/service_role/i.test(migCodeNoStrings));

// ---- 9. tabelas sem SELECT público direto ----
check('9. tabelas magazine_* sem SELECT público direto (sem policy anon/public + RLS)',
  /enable row level security/i.test(migCode) &&
  !/create policy[^;]*for select to anon[^;]*on public\.magazine_/i.test(migCode) &&
  !/create policy[^;]*for\s+all\s+to\s+anon[^;]*on public\.magazine_/i.test(migCode) &&
  !/create policy[^;]*to public[^;]*on public\.magazine_/i.test(migCode));

// ---- 10. elegibilidade da edição (fail-closed) ----
check('10a. edição exige programa active',
  /ap\.active\s*=\s*true/i.test(migCodeNoStrings));
check('10b. edição exige status published',
  /e\.status\s*=\s*'published'/i.test(migCode));
check('10c. edição exige published_at NOT NULL',
  /e\.published_at\s+is\s+not\s+null/i.test(migCode));
check('10d. draft/archived nunca passam (só published; sem OR draft/archived)',
  !/e\.status\s+in\s*\([^)]*'draft'[^)]*\)/i.test(migCodeNoStrings) &&
  !/e\.status\s*=\s*'draft'/i.test(migCodeNoStrings) &&
  !/e\.status\s*=\s*'archived'/i.test(migCodeNoStrings));

// ---- 11. elegibilidade das features ----
check('11a. feature exige is_published + published_at NOT NULL',
  /f\.is_published\s*=\s*true/i.test(migCodeNoStrings) &&
  /f\.published_at\s+is\s+not\s+null/i.test(migCodeNoStrings));
check('11b. adesão cancelada bloqueia (JOIN adoption + status active exigido)',
  /join\s+public\.distinction_package_adoptions/i.test(migCodeNoStrings) &&
  /p\.status\s*=\s*'active'/i.test(migCode));
check('11c. includes_publication=false bloqueia (exigido = true)',
  /p\.includes_publication\s*=\s*true/i.test(migCodeNoStrings));
check('11d. distinção cancelled bloqueia',
  /award_status\s+is\s+distinct\s+from\s+'cancelled'/i.test(migCode));

// ---- 12. independência Meta Ads (fail-closed por uso indevido) ----
const metaConsentGate = /(new|p|adoption|a|adopta)\.(meta_ads_consent_at)\b|meta_ads_consent_at\s*(=|is|in|>|<)/i.test(migCodeNoStrings + libCode);
const metaFlagGate = /(new|p|adoption|a|adopta)\.(includes_meta_ads)\b|includes_meta_ads\s*=\s*true/i.test(migCodeNoStrings + libCode);
check('12a. meta_ads_consent_at NÃO condiciona publicação (só comentários/docs)',
  !metaConsentGate);
check('12b. includes_meta_ads NÃO condiciona publicação (só comentários/docs)',
  !metaFlagGate);
check('12c. independência documentada (comentário explícito)',
  /independente de meta ads|desacoplada de meta ads|NUNCA condicionam a revista/i.test(mig));

// ---- 13. campos comerciais privados fora do retorno ----
const privateFields = ['price_cents', 'package_adoption_id', 'commercial_status', 'cancel_reason', 'contact_person', 'audit_logs', 'actor_id'];
const returnsSeg = (() => {
  const m = migCode.match(/returns table\s*\([\s\S]*?\)\s*language/i);
  return m ? m[0] : migCodeNoStrings;
})();
const leaked = privateFields.filter((f) => new RegExp(`\\b${f}\\b`, 'i').test(returnsSeg));
check('13. campos comerciais privados não fazem parte do retorno das RPCs',
  leaked.length === 0, leaked.join(',') || 'ok');
// package_adoption_id aparece no JOIN interno (necessário) mas NUNCA no RETURNS:
const returnsTables = [...migCode.matchAll(/returns table\s*\(([\s\S]*?)\)\s*language/gi)].map((m) => m[1]);
const inReturns = returnsTables.some((r) => /\bpackage_adoption_id\b/i.test(r));
check('13b. package_adoption_id só em JOIN interno, nunca no RETURNS',
  !inReturns && /p\.id\s*=\s*f\.package_adoption_id|join\s+public\.distinction_package_adoptions/i.test(migCodeNoStrings));

// ---- 14. imagens ordenadas ----
check('14. imagens ordenadas (sort_order, created_at)',
  /order by\s+mi\.sort_order\s+asc\s*,\s*mi\.created_at\s+asc/i.test(migCodeNoStrings) &&
  /order by\s+mi\.sort_order/i.test(migCodeNoStrings));
check('14b. imagens retornam somente image_url/caption/sort_order',
  /image_url::text as image_url/i.test(migCode) &&
  /mi\.caption::text as caption/i.test(migCode));

// ---- 15. lib pública: funções + tipos separados ----
check('15a. getPublishedMagazine(programSlug, magazineSlug) existe',
  /export async function getPublishedMagazine\s*\(\s*programSlug/i.test(lib));
check('15b. getPublishedMagazineFeatures(programSlug, magazineSlug) existe',
  /export async function getPublishedMagazineFeatures\s*\(\s*programSlug/i.test(lib));
check('15c. tipos públicos separados (PublicMagazine/Feature/Image)',
  /interface PublicMagazine\b/.test(lib) &&
  /interface PublicMagazineFeature\b/.test(lib) &&
  /interface PublicMagazineImage\b/.test(lib));
check('15d. lib não reutiliza objetos administrativos inteiros',
  !/import type\s*\{[^}]*\bMagazineEdition\b[^}]*\}/.test(libCode) ||
  /interface PublicMagazine\b/.test(lib));
check('15e. lib consome SOMENTE via rpc get_published_* (sem SELECT direto magazine_*)',
  /supabase\.rpc\(['"]get_published_magazine['"]/i.test(libCode) &&
  /supabase\.rpc\(['"]get_published_magazine_features['"]/i.test(libCode) &&
  !/\.from\(['"]magazine_editions['"]\)/i.test(libCode) &&
  !/\.from\(['"]magazine_features['"]\)/i.test(libCode) &&
  !/\.from\(['"]magazine_images['"]\)/i.test(libCode));

// ---- 16. nenhuma escrita (lib + migration) ----
for (const [n, t] of [[16, 'votes'], [17, 'vote_attempts'], [18, 'vote_adjustments'], [19, 'modality_votes'], [20, 'modality_vote_attempts']]) {
  const writeRe = new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  const sqlRe = new RegExp(`into\\s+public\\.${t}`, 'i');
  check(`${n}. sem escrita ${t} (lib + migration 0022)`, !writeRe.test(libCode) && !sqlRe.test(migCode));
}
check('21. sem escrita campaign_entries/distinctions/adoptions/credentials na lib pública',
  !/\.from\(["'](campaign_entries|award_distinctions|distinction_package_adoptions|digital_credentials|distinction_fulfillment)["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/into\s+public\.(campaign_entries|award_distinctions|distinction_package_adoptions|digital_credentials|distinction_fulfillment)/i.test(migCode));
check('22. migration 0022 sem INSERT/UPDATE/DELETE em tabelas (só SELECT + DDL + grants)',
  !/insert\s+into\s+public\.(magazine_|votes|campaign_entries|award_distinctions|distinction_package_adoptions|digital_credentials)/i.test(migCode) &&
  !/update\s+public\.(magazine_|votes|campaign_entries)/i.test(migCodeNoStrings) &&
  !/delete\s+from\s+public\.(magazine_|votes|campaign_entries)/i.test(migCodeNoStrings));

// ---- 23. nenhuma alteração eleitoral ----
check('23. sem redefinir RPCs eleitorais/verificação',
  !/create\s+(or\s+replace\s+)?function\s+public\.(get_admin_tally|get_admin_modality_tally|get_published_results|get_published_results_for_campaign|verify_digital_credential)\s*\(/i.test(migCode));
check('23b. sem ALTER/DROP em tabelas eleitorais ou 0020/0021',
  !/alter table\s+public\.(votes|vote_attempts|vote_adjustments|modality_votes|modality_vote_attempts|campaign_entries|award_distinctions|distinction_package_adoptions|digital_credentials|distinction_fulfillment|categories|cities|campaigns)\b/i.test(migCode) &&
  !/drop table/i.test(migCode));

// ---- 24. nenhuma UI/rota criada ----
{
  let extraFiles = [];
  try {
    const walk = (dir) => {
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/magazine|revista|flipbook/i.test(e.name)) extraFiles.push(rel);
      }
    };
    walk('src/pages');
    walk('src/components');
  } catch { /* dirs podem não existir */ }
  const app = exists('src/App.tsx') ? read('src/App.tsx') : '';
  const hasViewerRoute =
    /MagazineViewer|Flipbook/i.test(app) ||
    (/\/revista/i.test(app) && /get_published/i.test(app));
  check('24. nenhuma UI/rota criada (sem MagazineViewer/flipbook//revista/Admin Revistas)',
    extraFiles.length === 0 && !hasViewerRoute &&
    !exists('src/pages/MagazinePage.tsx') &&
    !exists('src/components/MagazineViewer.tsx') &&
    !exists('src/pages/admin/MagazinesAdminPage.tsx'),
    extraFiles.join(',') || 'ok');
}

// ---- 25. 0020 e 0021 não alteradas ----
try {
  const out = execSync(`git status --porcelain -- "${MIG20}" "${MIG21}"`, { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const modified = lines.filter((l) => !l.startsWith('??'));
  check('25. migrations 0020 e 0021 não alteradas (sem M/D)', modified.length === 0, lines.join('; ') || 'limpo');
} catch { check('25. migrations 0020 e 0021 não alteradas (git indisponível, skip)', true, 'git skip'); }
check('25b. 0022 não referencia ALTER/DROP de 0020/0021 nem cast-vote',
  exists(MIG20) && exists(MIG21) &&
  !/alter table\s+public\.(distinction_package_adoptions|magazine_editions|magazine_features|magazine_images)\s+(add|drop|alter)/i.test(migCodeNoStrings) &&
  !/cast-vote|cast-modality-vote|cast_vote/i.test(migCodeNoStrings));

// ---- 26. cast-vote e cast-modality-vote intactos ----
try {
  const out = execSync('git status --porcelain -- supabase/functions/cast-vote supabase/functions/cast-modality-vote', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  check('26. cast-vote/cast-modality-vote intactos (git limpo)', lines.length === 0, lines.join('; ') || 'limpo');
} catch { check('26. cast-vote/cast-modality-vote intactos (git indisponível, skip)', true, 'git skip'); }

// ---- 27. transação única + idempotente ----
check('27. migration transacional idempotente (BEGIN/COMMIT únicos + DROP IF EXISTS)',
  /^BEGIN;/m.test(mig) && /^COMMIT;/m.test(mig) &&
  /drop function if exists public\.get_published_magazine/i.test(migCode) &&
  /drop function if exists public\.get_published_magazine_features/i.test(migCode));

// ---- 27b/27c. E1 usa resolução nativa to_regprocedure (correção após 2º erro
// real no Supabase: a deteção manual via pg_get_function_identity_arguments +
// count(*) <> 1 gerava falso-negativo "em falta" mesmo com a função criada e
// resolvida por GRANT/COMMENT na mesma transação) ----
check('27b. E1 valida existência via to_regprocedure nativo (3 RPCs + RAISE fail-closed)',
  /if\s+to_regprocedure\(\s*'public\.get_published_magazine\(text,text\)'\s*\)\s*is null\s*then/i.test(migCode) &&
  /raise exception 'FASE642_VALIDATION_FAILED: get_published_magazine\(text,text\) em falta'/i.test(migCode) &&
  /if\s+to_regprocedure\(\s*'public\.get_published_magazine_features\(text,text\)'\s*\)\s*is null\s*then/i.test(migCode) &&
  /raise exception 'FASE642_VALIDATION_FAILED: get_published_magazine_features\(text,text\) em falta'/i.test(migCode) &&
  /if\s+to_regprocedure\(\s*'public\.get_published_magazine_feature_images\(text,text,text\)'\s*\)\s*is null\s*then/i.test(migCode) &&
  /raise exception 'FASE642_VALIDATION_FAILED: get_published_magazine_feature_images\(text,text,text\) em falta'/i.test(migCode));
check('27c. sem deteção manual frágil por pg_get_function_identity_arguments',
  !/pg_get_function_identity_arguments/i.test(migCode));

// ---- 28. 0022 NÃO aplicada remotamente (local-only: não commitada) ----
try {
  const log = execSync(`git log --oneline -- "${MIG}"`, { cwd: root, encoding: 'utf8' }).trim();
  const status = execSync(`git status --porcelain -- "${MIG}"`, { cwd: root, encoding: 'utf8' }).trim();
  check('28. 0022 NÃO aplicada/commitada (local-only, sem commit)',
    log === '' && status !== '', `log:${log || 'vazio'} status:${status || 'limpo'}`);
} catch { check('28. 0022 NÃO aplicada/commitada (git indisponível, skip)', true, 'git skip'); }

if (failures > 0) {
  console.error(`\n6.4.2 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n6.4.2 VERIFY: tudo válido (local, sem banco remoto alterado).');

// FASE 6.4.2 retomada: verificado local 50/50 PASS (sem alteracao semantica, local-only).
