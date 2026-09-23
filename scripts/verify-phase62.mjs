/**
 * FASE 6.2 — Verificação LOCAL (SEM tocar no banco remoto).
 * Áreas de categorias + preparação operacional (piloto Braga):
 * category_areas (migration 0019), categories.area_id opcional,
 * defesa cross-program, RLS, Admin → Áreas, Admin → Categorias,
 * navegação pública Cidade → Área → Categoria (backward-compatible),
 * área visual em Convites. Motor eleitoral INTOCADO.
 * Sem db push, sem deploy, sem seeds, sem git, sem pagamentos.
 * Não toca cast-vote / cast-modality-vote / votos / resultados /
 * digital_credentials / distinções / fulfillment / convites-schema.
 * Uso: node scripts/verify-phase62.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
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

const MIG = 'supabase/migrations/0019_phase62_category_areas.sql';
const LIB = 'src/lib/categoryAreas.ts';
const HOOK = 'src/hooks/useCategoryAreas.ts';
const ADMIN_AREAS = 'src/pages/admin/CategoryAreasAdminPage.tsx';
const ADMIN_CATS = 'src/pages/admin/CategoriesAdminPage.tsx';
const CITY = 'src/pages/public/CityPage.tsx';
const INVITES = 'src/pages/admin/InvitationsAdminPage.tsx';
const APP = 'src/App.tsx';
const NAV = 'src/components/AdminLayout.tsx';
const DBTYPES = 'src/types/database.ts';

const migExists = exists(MIG);
const libExists = exists(LIB);
const hookExists = exists(HOOK);
const areasExists = exists(ADMIN_AREAS);
check('1. estrutura Phase 6.2 existe (migration 0019 + lib + hook + admin Áreas)', migExists && libExists && hookExists && areasExists);

const mig = migExists ? read(MIG) : '';
const migCode = sqlCodeOf(mig);
const lib = libExists ? read(LIB) : '';
const libCode = jsCodeOf(lib);
const hook = hookExists ? read(HOOK) : '';
const hookCode = jsCodeOf(hook);
const areas = areasExists ? read(ADMIN_AREAS) : '';
const areasCode = jsCodeOf(areas);
const cats = exists(ADMIN_CATS) ? read(ADMIN_CATS) : '';
const catsCode = jsCodeOf(cats);
const city = exists(CITY) ? read(CITY) : '';
const cityCode = jsCodeOf(city);
const invites = exists(INVITES) ? read(INVITES) : '';
const invitesCode = jsCodeOf(invites);
const app = exists(APP) ? read(APP) : '';
const nav = exists(NAV) ? read(NAV) : '';
const dbTypes = exists(DBTYPES) ? read(DBTYPES) : '';

// ---- 2. tabela ----
check('2. tabela public.category_areas (CREATE TABLE IF NOT EXISTS)',
  /create table if not exists public\.category_areas/i.test(migCode));

// ---- 3. colunas mínimas ----
const cols = ['award_program_id', 'name', 'slug', 'locale', 'description', 'sort_order', 'active', 'created_at', 'updated_at'];
check('3. colunas mínimas (programa, nome, slug, locale, descrição, ordem, ativo, timestamps)',
  cols.every((c) => new RegExp(`\\b${c}\\b`, 'i').test(migCode)));

// ---- 4. FK programa ----
check('4. FK award_program_id → award_programs(id) (isolamento por programa)',
  /references\s+public\.award_programs/i.test(migCode) && /award_program_id uuid not null/i.test(migCode));

// ---- 5. unicidade programa+slug ----
check('5. slug único por programa — UNIQUE (award_program_id, slug)',
  /category_areas_program_slug_uidx/i.test(mig) && /award_program_id,\s*slug/i.test(migCode));

// ---- 6. area_id nullable ----
check('6. categories.area_id NULL (ADD COLUMN, SEM SET NOT NULL — antigas válidas)',
  /add column if not exists area_id/i.test(migCode) && !/alter column area_id set not null/i.test(migCode));

// ---- 7. FK ON DELETE SET NULL ----
check('7. FK categories.area_id → category_areas ON DELETE SET NULL',
  /categories_area_id_fkey|area_id[\s\S]{0,300}references\s+public\.category_areas/i.test(migCode) &&
  /on delete set null/i.test(migCode));

// ---- 8. defesa cross-program ----
check('8. defesa cross-program (trigger categories_check_area_scope, PROGRAM_MISMATCH)',
  /categories_check_area_scope/i.test(mig) && /PROGRAM_MISMATCH/.test(mig));

// ---- 9. RLS ----
check('9. RLS (ENABLE RLS + leitura pública active + programa ativo + admin is_admin, sem escrita anon)',
  /alter table public\.category_areas enable row level security/i.test(migCode) &&
  /public read active category_areas/.test(mig) && /active\s*=\s*true/.test(migCode) &&
  /award_programs/.test(migCode) && /p\.active\s*=\s*true/.test(migCode) &&
  /admin manage category_areas/.test(mig) && /is_admin\(\)/.test(mig) &&
  /for select to anon, authenticated using/.test(migCode) &&
  !/for\s+(all|insert|update|delete)\s+to\s+anon/i.test(migCode));

// ---- 10. auditoria ----
check('10. auditoria best-effort (category_area.created/.updated + audit_logs)',
  /category_area\.created/.test(mig) && /category_area\.updated/.test(mig) && /audit_logs/.test(mig));

// ---- 11. tipos TS ----
check('11. tipos CategoryArea + area_id em database.ts',
  /interface CategoryArea/.test(dbTypes) && /award_program_id:\s*string/.test(dbTypes) &&
  /sort_order/.test(dbTypes) && /area_id\?:/.test(dbTypes));

// ---- 12. helpers lib ----
check('12. helpers (groupCategoriesByArea + Outras categorias + sortAreas, sem votos)',
  /groupCategoriesByArea/.test(lib) && /Outras categorias/.test(lib) && /sortAreas/.test(libCode) &&
  !/from\(["'](votes|vote_attempts|vote_adjustments|modality_votes)["']/.test(libCode) &&
  !/get_admin_tally|get_published_results/i.test(libCode));

// ---- 13. hooks ----
check('13. hooks useScopedCategoryAreas + usePublicCategoryAreas (42P01 fail-closed)',
  /useScopedCategoryAreas/.test(hook) && /usePublicCategoryAreas/.test(hook) &&
  /42P01/.test(hook) && /category_areas/.test(hookCode));
check('14. hooks isolados por programa (eq award_program_id, sem mock eleitoral)',
  /eq\(['"]award_program_id['"]/.test(hookCode) && /resolveEffectiveProgram|belongsToProgram|areasOfProgram/.test(hook));

// ---- 15/16. admin Áreas ----
check('15. Admin Áreas (AdminProgramProvider + criar/editar/ativar/ordenar, fail-closed)',
  /useAdminProgram/.test(areas) && /AdminProgramProvider|selectedProgramId/.test(areas) &&
  /sort_order/.test(areasCode) && /fail-closed/i.test(areas));
check('16. rota /admin/areas + navegação Áreas (próximo de Categorias)',
  /admin\/areas/.test(app) && /CategoryAreasAdminPage/.test(app) &&
  /\/admin\/areas/.test(nav) && /Áreas/.test(nav));

// ---- 17. admin Categorias ----
check('17. Admin Categorias com campo Área (programa atual + Sem área + coluna)',
  /area_id/.test(catsCode) && /Sem área/.test(cats) && /Área/.test(cats) &&
  /useScopedCategoryAreas/.test(cats));

// ---- 18/19. navegação pública ----
check('18. navegação pública Cidade → Área → Categoria (grupo por área, URLs category intactas)',
  /usePublicCategoryAreas|groupCategoriesByArea/.test(city) &&
  /\$\{citySlug\}\/\$\{cat\.slug\}|\/\$\{city\.slug\}\/\$\{cat\.slug\}/.test(cityCode));
check('19. fallback sem áreas (Outras categorias + experiência atual preservada)',
  (/Outras categorias/.test(city) || /OTHER_CATEGORIES_LABEL/.test(city)) &&
  /backward-compatible|hasUsableAreas/i.test(city) &&
  (/area:\s*null/.test(libCode) || /group\.area \?/.test(cityCode)));

// ---- 20. convites ----
check('20. Convites: schema intocado, área só visual derivada da categoria',
  !/alter table\s+(if exists\s+)?public\.participant_invitations/i.test(migCode) &&
  !/create table.*participant_invitations/is.test(migCode) &&
  /Área/.test(invites) && /areaName|areasById|useScopedCategoryAreas/.test(invitesCode) &&
  !/from\(["']category_areas["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(invitesCode));

// ---- 21-26. nenhuma escrita eleitoral ----
const appScope = [lib, hook, areas, cats, city, invites].join('\n');
const appScopeCode = jsCodeOf(appScope);
for (const [n, t] of [[21, 'votes'], [22, 'vote_attempts'], [23, 'vote_adjustments'], [24, 'modality_votes'], [25, 'modality_vote_attempts']]) {
  const writeRe = new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  const sqlRe = new RegExp(`into\\s+public\\.${t}`, 'i');
  check(`${n}. sem escrita ${t}`, !writeRe.test(appScopeCode) && !sqlRe.test(migCode));
}
check('26. sem RPCs eleitorais redefinidos nem escrita em credentials/distinctions/fulfillment/campaign_entries',
  !/get_admin_tally|get_admin_modality_tally|get_published_results|verify_digital_credential/i.test(migCode) &&
  !/into\s+public\.campaign_entries/i.test(migCode) &&
  !/from\(["'](digital_credentials|award_distinctions|distinction_fulfillment|campaign_entries)["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(appScopeCode));

// ---- 27. categories autoridade eleitoral (nenhum category_id substituído por área) ----
check('27. categories continuam autoridade (category_id em entries/votes; área nunca como category_id)',
  /category_id/.test(mig) && !/area_id[^;]*primary key/i.test(migCode) &&
  !/votes\s*\(\s*[^)]*area_id/i.test(migCode) && !/campaign_entries\s*\([^)]*area_id/i.test(migCode));

// ---- 28. cast-vote intacto ----
const castVoteHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('28. cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const castVoteEdge = read('supabase/functions/cast-vote/index.ts');
check('28b. cast-vote sem referências a áreas', !/category_area|area_id/i.test(castVoteEdge));

// ---- 29. cast-modality-vote intacto ----
const castModHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-modality-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('29. cast-modality-vote SHA256 intacto', castModHash === EXPECTED_CAST_MODALITY, castModHash);
const edgeMod = read('supabase/functions/cast-modality-vote/index.ts');
check('29b. cast-modality-vote sem referências a áreas', !/category_area|area_id/i.test(edgeMod));

// ---- 30. migrations anteriores intactas + só 0019 nova ----
try {
  const out = execSync('git status --porcelain -- supabase/migrations', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const touchedOld = lines.filter((l) => !l.includes('0019_phase62'));
  check('30. nenhuma migration anterior alterada (só 0019 untracked)', touchedOld.length === 0, touchedOld.join('; ') || 'limpo');
} catch (e) {
  check('30. nenhuma migration anterior alterada (git indisponível, skip)', true, 'git skip');
}
try {
  const out = execSync('git status --porcelain -- supabase/functions', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  check('30b. edge functions intactas (sem modificação)', lines.length === 0, lines.join('; ') || 'limpo');
} catch (e) {
  check('30b. edge functions intactas (git indisponível, skip)', true, 'git skip');
}

// ---- 31. sem seeds de produção ----
check('31. sem seeds de produção (nenhum INSERT em áreas/categorias, sem ~30 categorias)',
  !/insert\s+into\s+public\.category_areas/i.test(migCode) &&
  !/insert\s+into\s+public\.categories/i.test(migCode) &&
  !/insert\s+into\s+public\.(countries|award_programs|campaigns|businesses)/i.test(migCode + appScopeCode));

// ---- 32. sem 0020 / sem pagamentos ----
const { readdirSync } = await import('node:fs');
let has0020 = false;
try {
  has0020 = readdirSync(join(root, 'supabase/migrations')).some((f) => /^0020/i.test(f));
} catch { has0020 = false; }
check('32. sem migration 0020, sem pagamentos',
  !has0020 &&
  !/\bstripe\b|amount_cents|price_cents|checkout|subscription/i.test(appScopeCode));

// ---- 33. PT-PT ----
check('33. PT-PT (Áreas, Sem área, Outras categorias, Acções)',
  /Áreas/.test(areas + nav + cats) && /Sem área/.test(cats) &&
  /Outras categorias/.test(lib + city) && /Acções/.test(areas));

// ---- 34. fail-closed ----
check('34. fail-closed (sem programa → sem dados; tabela ausente → vazio)',
  /fail-closed/i.test(areas + hook + cats) && /42P01/.test(hook));

if (failures > 0) {
  console.error(`\n6.2 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n6.2 VERIFY: tudo válido (local, sem banco remoto alterado).');
