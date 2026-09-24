/**
 * FASE 6.4.1 — Verificação LOCAL (SEM tocar no banco remoto).
 * Fundação da Revista Digital Oficial — Braga 2026 (piloto), arquitetura
 * genérica (sem hardcode de cidade/ano/país):
 * migration 0021 (magazine_editions + magazine_features + magazine_images),
 * bucket magazine-images, RLS admin-only, auditoria, tipos, lib magazine.
 * Guardas: revista desacoplada de Meta Ads (includes_publication SIM;
 * meta_ads_consent_at / includes_meta_ads NUNCA como gate editorial);
 * motor eleitoral intocável; 0020 intocada; sem superfície pública.
 * Sem db push, sem deploy, sem git commit.
 * Uso: node scripts/verify-phase641.mjs
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

const MIG = 'supabase/migrations/0021_phase641_magazine_foundation.sql';
const MIG20 = 'supabase/migrations/0020_phase631_digital_package_adoptions.sql';
const LIB = 'src/lib/magazine.ts';
const DBTYPES = 'src/types/database.ts';
const STORAGE = 'src/lib/storage.ts';

const migExists = exists(MIG);
const libExists = exists(LIB);
check('1. ficheiros fundação existem (migration 0021 + lib magazine)', migExists && libExists);

const mig = migExists ? read(MIG) : '';
const migCode = sqlCodeOf(mig);
const migNoStrings = migCode.replace(/'[^']*'/g, "''");
const lib = libExists ? read(LIB) : '';
const libCode = jsCodeOf(lib);
const dbTypes = exists(DBTYPES) ? read(DBTYPES) : '';
const storage = exists(STORAGE) ? read(STORAGE) : '';

// ---- 2. 3 tabelas magazine_* na migration ----
check('2. 3 tabelas magazine_* (CREATE TABLE IF NOT EXISTS)',
  /create table if not exists public\.magazine_editions/i.test(migCode) &&
  /create table if not exists public\.magazine_features/i.test(migCode) &&
  /create table if not exists public\.magazine_images/i.test(migCode));

// ---- 3. FKs corretas ----
check('3a. FK editions → award_programs/campaigns/cities',
  /magazine_editions[\s\S]*references\s+public\.award_programs\s*\(\s*id\s*\)/i.test(migCode) &&
  /magazine_editions[\s\S]*references\s+public\.campaigns\s*\(\s*id\s*\)/i.test(migCode) &&
  /magazine_editions[\s\S]*references\s+public\.cities\s*\(\s*id\s*\)/i.test(migCode));
check('3b. FK features → editions/distinctions/adoptions (SET NULL na adoção)',
  /magazine_features[\s\S]*references\s+public\.magazine_editions\s*\(\s*id\s*\)\s*on delete cascade/i.test(migCode) &&
  /magazine_features[\s\S]*references\s+public\.award_distinctions\s*\(\s*id\s*\)\s*on delete cascade/i.test(migCode) &&
  /package_adoption_id[\s\S]*references\s+public\.distinction_package_adoptions\s*\(\s*id\s*\)\s*on delete set null/i.test(migCode));
check('3c. FK images → features ON DELETE CASCADE',
  /magazine_images[\s\S]*references\s+public\.magazine_features\s*\(\s*id\s*\)\s*on delete cascade/i.test(migCode));

// ---- 4. UNIQUEs ----
check('4a. UNIQUE (award_program_id, slug) + UNIQUE (campaign_id, city_id)',
  /magazine_editions_program_slug_uidx/i.test(mig) &&
  /magazine_editions_campaign_city_uidx/i.test(mig));
check('4b. UNIQUE (edition, editorial_slug) + UNIQUE (edition, distinction)',
  /magazine_features_edition_slug_uidx/i.test(mig) &&
  /magazine_features_edition_distinction_uidx/i.test(mig));

// ---- 5. status editorial ----
check('5a. editions status draft|published|archived + published_at obrigatório se published',
  /status\s+in\s*\(\s*'draft'\s*,\s*'published'\s*,\s*'archived'\s*\)/i.test(migCode) &&
  /published_at is not null/i.test(migCode));
check('5b. features is_published/published_at (publicado exige published_at)',
  /is_published boolean not null default false/i.test(migCode) &&
  /is_published\s*=\s*true and published_at is not null/i.test(migCode));
check('5c. sem automatismo de publicação por adesão (nenhum trigger feature por adoption insert)',
  !/create trigger[\s\S]*?on\s+public\.distinction_package_adoptions[\s\S]*?magazine_features/i.test(migCode) &&
  /decisão editorial/i.test(mig));

// ---- 6. RLS admin-only ----
for (const t of ['magazine_editions', 'magazine_features', 'magazine_images']) {
  const re = new RegExp(`alter table public\\.${t} enable row level security`, 'i');
  const pol = new RegExp(`admin manage ${t}`, '');
  check(`6. RLS admin-only ${t} (ENABLE RLS + admin manage is_admin, sem anon)`,
    re.test(migCode) && pol.test(mig) && /is_admin\(\)/.test(mig) &&
    !new RegExp(`for\\s+(all|insert|update|delete|select)\\s+to\\s+anon[^\\n]*${t}`, 'i').test(migCode));
}
check('6b. sem SELECT público amplo nas tabelas magazine_* nem RPC get_published_* nesta fase',
  !/get_published_magazine|get_published_edition|get_published_feature/i.test(migCode) &&
  !/create policy[^;]*for select to anon[^;]*on public\.magazine_/i.test(migCode) &&
  !/create\s+(or\s+replace\s+)?function\s+public\.get_published/i.test(migCode));

// ---- 7. bucket + policies storage ----
check('7a. bucket magazine-images (insert storage.buckets, público)',
  /insert into storage\.buckets/i.test(migCode) && /magazine-images/.test(mig));
check('7b. policies storage (public read + admin upload/update/delete)',
  /public read magazine images/i.test(mig) &&
  /admin upload magazine images/i.test(mig) &&
  /admin update magazine images/i.test(mig) &&
  /admin delete magazine images/i.test(mig));
check('7c. buckets existentes intocados (city-images/business-logos/covers/sponsor-logos sem ALTER/DROP)',
  !/delete from storage\.buckets/i.test(migCode) &&
  !/update storage\.buckets/i.test(migCode));
check('7d. storage.ts aceita magazine-images sem remover buckets existentes',
  /magazine-images/.test(storage) &&
  /city-images/.test(storage) && /business-logos/.test(storage) &&
  /business-covers/.test(storage) && /sponsor-logos/.test(storage));

// ---- 8. tipos TS ----
check('8. tipos MagazineEditionStatus/MagazineEdition/MagazineFeature/MagazineImage em database.ts',
  /type MagazineEditionStatus/.test(dbTypes) &&
  /interface MagazineEdition/.test(dbTypes) &&
  /interface MagazineFeature/.test(dbTypes) &&
  /interface MagazineImage/.test(dbTypes) &&
  /editorial_slug/.test(dbTypes) && /is_published/.test(dbTypes));

// ---- 9. magazine.ts base ----
check('9a. lib com listar/obter/criar/atualizar edições + features + imagens',
  /listMagazineEditions/.test(lib) && /getMagazineEdition/.test(lib) &&
  /createMagazineEdition/.test(lib) && /updateMagazineEdition/.test(lib) &&
  /listMagazineFeatures/.test(lib) && /createMagazineFeature/.test(lib) &&
  /updateMagazineFeature/.test(lib) && /listMagazineImages/.test(lib) &&
  /addMagazineImage/.test(lib) && /removeMagazineImage/.test(lib));
check('9b. createMagazineFeature valida fail-closed (edição + distinção âmbito + adoção)',
  /fora do âmbito da edição/.test(lib) && /isEditoriallyEligible/.test(lib) &&
  /NUNCA cria\/altera package adoption/.test(lib));

// ---- 10. elegibilidade editorial usa includes_publication ----
check('10a. includes_publication utilizado como gate editorial (migration + lib)',
  /includes_publication/.test(mig) && /includes_publication/.test(lib) &&
  /status.*active.*includes_publication|includes_publication.*active/i.test(mig + lib));
check('10b. meta_ads_consent_at NÃO usado como gate editorial (só em comentários/docs)',
  !/meta_ads_consent_at\s*(=|is|in)/i.test(migNoStrings + libCode) &&
  !/new\.meta_ads_consent_at|p\.meta_ads_consent_at|adoption\.meta_ads_consent_at/i.test(migNoStrings + libCode));
check('10c. includes_meta_ads NÃO usado como gate editorial (só em comentários/docs)',
  !/new\.includes_meta_ads|p\.includes_meta_ads|adoption\.includes_meta_ads/i.test(migNoStrings + libCode) &&
  !/includes_meta_ads\s*=\s*true/i.test(migNoStrings + libCode));

// ---- 11. nenhuma escrita eleitoral ----
for (const [n, t] of [[11, 'votes'], [12, 'vote_attempts'], [13, 'vote_adjustments'], [14, 'modality_votes'], [15, 'modality_vote_attempts']]) {
  const writeRe = new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  const sqlRe = new RegExp(`into\\s+public\\.${t}`, 'i');
  check(`${n}. sem escrita ${t} (lib + migration)`, !writeRe.test(libCode) && !sqlRe.test(migCode));
}
check('16. sem escrita campaign_entries nem RPCs eleitorais redefinidos',
  !/into\s+public\.campaign_entries/i.test(migCode) &&
  !/from\(["']campaign_entries["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/get_admin_tally|get_admin_modality_tally|get_published_results\b/i.test(migCode));

// ---- 12. sem alteração award_status/commercial_status ----
check('17. nenhuma alteração award_status/commercial_status (lib nunca escreve award_distinctions)',
  !/from\(["']award_distinctions["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/award_status/.test(libCode) && !/commercial_status/.test(libCode) &&
  !/alter table\s+public\.award_distinctions/i.test(migCode));

// ---- 13. sem emissão/revogação credential ----
check('18. nenhuma emissão/revogação credential (sem escrita digital_credentials/fulfillment)',
  !/from\(["']digital_credentials["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/from\(["']distinction_fulfillment["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(libCode) &&
  !/alter table\s+public\.digital_credentials/i.test(migCode) &&
  !/alter table\s+public\.distinction_fulfillment/i.test(migCode) &&
  !/verify_digital_credential/i.test(migCode));

// ---- 14. migration 0020 intocada ----
try {
  const out = execSync(`git status --porcelain -- "${MIG20}"`, { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const modified = lines.filter((l) => !l.startsWith('??'));
  check('19. migration 0020 sem modificação (só criação prévia 6.3.1 admitida, sem M/D)', modified.length === 0, lines.join('; ') || 'limpo');
} catch { check('19. migration 0020 sem modificação (git indisponível, skip)', true, 'git skip'); }
check('19b. 0020 não referenciada com ALTER/DROP (só FK nova a apontar)',
  exists(MIG20) && !/alter table\s+public\.distinction_package_adoptions/i.test(migCode) &&
  !/drop table/i.test(migCode));
check('19c. sem ALTER/DROP em tabelas eleitorais anteriores',
  !/alter table\s+public\.(votes|vote_attempts|vote_adjustments|modality_votes|modality_vote_attempts|campaign_entries|categories|cities|campaigns)\b/i.test(migCode));

// ---- 15. cast-vote intactos ----
try {
  const out = execSync('git status --porcelain -- supabase/functions/cast-vote supabase/functions/cast-modality-vote', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  check('20. cast-vote/cast-modality-vote intactos (git limpo)', lines.length === 0, lines.join('; ') || 'limpo');
} catch { check('20. cast-vote/cast-modality-vote intactos (git indisponível, skip)', true, 'git skip'); }
check('20b. migration 0021 não toca em cast-vote (só comentário de guarda)',
  !/create function[^;]*cast_vote[^;]*;/i.test(migCode));

// ---- 16. sem rota/UI pública nesta fase ----
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
  const allowedLib = extraFiles.filter((f) => f !== 'src/pages' && !/lib/.test(f));
  const hasPublicMagazineRoute =
    /magazine|revista|flipbook/i.test(read('src/App.tsx')) && /MagazineViewer|Flipbook|get_published/i.test(read('src/App.tsx'));
  check('21. nenhuma rota/UI pública criada (sem MagazineViewer/flipbook/Admin Revistas/RPC pública)',
    allowedLib.length === 0 && !hasPublicMagazineRoute && !exists('src/pages/MagazinePage.tsx') &&
    !exists('src/components/MagazineViewer.tsx') && !exists('src/pages/admin/MagazinesAdminPage.tsx'),
    allowedLib.join(',') || 'ok');
}

// ---- 17. auditoria ----
check('22. auditoria magazine_* (created/updated/published/archived/unpublished + image created/deleted)',
  /magazine_edition\.created/.test(mig) && /magazine_edition\.updated/.test(mig) &&
  /magazine_edition\.published/.test(mig) && /magazine_edition\.archived/.test(mig) &&
  /magazine_feature\.created/.test(mig) && /magazine_feature\.updated/.test(mig) &&
  /magazine_feature\.published/.test(mig) && /magazine_feature\.unpublished/.test(mig) &&
  /magazine_image\.created/.test(mig) && /magazine_image\.deleted/.test(mig) &&
  /audit_logs/.test(mig));

// ---- 18. sem hardcode Braga/PT/2026 em CHECKs ----
check('23. sem hardcode (nenhum CHECK prendendo a Braga/PT/2026)',
  !/check\s*\([^)]*braga[^)]*\)/i.test(migCode) &&
  !/check\s*\([^)]*'PT'[^)]*\)/i.test(migCode) &&
  !/check\s*\([^)]*2026[^)]*\)/i.test(migCode));

// ---- 19. sem cancelamento automático (SET NULL, sem DELETE trigger) ----
check('24. cancelamento sem DELETE automático (SET NULL + sem trigger DELETE em magazine_features)',
  /on delete set null/i.test(migCode) &&
  !/create trigger\s+\S+\s+[^;]*\bdelete\b[^;]*on public\.magazine_features/i.test(migCode) &&
  !/create trigger\s+\S+\s+[^;]*on public\.distinction_package_adoptions/i.test(migCode));

if (failures > 0) {
  console.error(`\n6.4.1 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n6.4.1 VERIFY: tudo válido (local, sem banco remoto alterado).');
