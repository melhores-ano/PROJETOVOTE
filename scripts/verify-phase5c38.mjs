/**
 * FASE 5C.3.8 — Verificação LOCAL (SEM tocar no banco remoto).
 * Valida a fundação sem executar SQL remotamente, sem db push, sem seeds.
 * Uso: node scripts/verify-phase5c38.mjs
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

// 1. cast-vote intocável
const castVotePath = join(root, 'supabase/functions/cast-vote/index.ts');
const castVoteHash = createHash('sha256').update(readFileSync(castVotePath, 'utf8')).digest('hex').toUpperCase();
check('cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);

// 2. Migration 0014 existe; nenhuma outra migration tocada
const migDir = join(root, 'supabase/migrations');
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
check('migrations 0001–0013 presentes', migs.length >= 14 && migs.slice(0, 13).every((f, i) => f.startsWith(String(i + 1).padStart(4, '0'))), migs.join(', '));
const m14 = join(migDir, '0014_phase5c38_award_modalities.sql');
check('migration 0014 existe', existsSync(m14));
const sql = existsSync(m14) ? readFileSync(m14, 'utf8') : '';
// Inspecção sobre código executável: remove comentários -- e /* */ para que
// menções em comentários "NÃO ..." não gerem falsos positivos.
const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('0014 sem INSERT de modalidades (sem seeds)', !/insert\s+into\s+public\.award_modalities/i.test(code));
check('0014 sem INSERT em votes', !/insert\s+into\s+public\.votes/i.test(code));
check('0014 sem UPDATE/DELETE em votes', !/(update|delete\s+from)\s+public\.votes/i.test(code));
check('0014 sem escrita em vote_adjustments', !/(insert|update|delete)\s+(into\s+)?public\.vote_adjustments/i.test(code));
check('0014 não redefine get_published_results', !/create\s+.*function\s+public\.get_published_results/i.test(code));
check('0014 não redefine get_admin_tally/overview', !/(create|drop)\s+.*function\s+public\.get_admin_/i.test(code));
check('0014 cria award_modalities', /create table if not exists public\.award_modalities/i.test(code));
check('0014 cria award_distinctions', /create table if not exists public\.award_distinctions/i.test(code));
check('0014 separa award_status/commercial_status', /award_status/.test(code) && /commercial_status/.test(code));
check('0014 source com 5 valores', /general_vote/.test(code) && /modality_vote/.test(code) && /'jury'/.test(code) && /'editorial'/.test(code) && /'manual'/.test(code));
check('0014 sem monetização (tabelas/colunas Stripe/preços)', !/create\s+table[^(]*\b(stripe|payments|prices|invoices|packages|checkout)\b/i.test(code) && !/\b(amount_cents|stripe_|price_cents|unit_price)\b/i.test(code));
check('0014 sem novo país/programa/2027', !/insert\s+into\s+public\.(countries|award_programs|campaigns)/i.test(code));

// 3. Frontend: rota + menu + contexto
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
check('App.tsx regista /admin/modalidades', app.includes('admin/modalidades') && app.includes('ModalitiesAdminPage'));
const layout = readFileSync(join(root, 'src/components/AdminLayout.tsx'), 'utf8');
check('AdminLayout tem item Modalidades', layout.includes('Modalidades') && layout.includes('/admin/modalidades'));
const page = readFileSync(join(root, 'src/pages/admin/ModalitiesAdminPage.tsx'), 'utf8');
check('Modalidades usa AdminProgramProvider/useAdminProgram', page.includes('useAdminProgram') && page.includes('AdminScopeBanner'));
check('Modalidades nunca escreve award_program_id manual', !/award_program_id:\s*form/i.test(page));
check('Página não referencia votes/vote_adjustments para escrita', !/from\(.votes.\)\s*\.\s*(insert|update|delete)/.test(page) && !/from\(.vote_adjustments.\)\s*\.\s*(insert|update|delete)/.test(page));
const types = readFileSync(join(root, 'src/types/database.ts'), 'utf8');
check('types têm AwardModality/AwardDistinction', types.includes('AwardModality') && types.includes('AwardDistinction'));
check('types separam award/commercial status', types.includes('AwardStatus') && types.includes('CommercialStatus'));

// 4. Integridade de âmbito: nenhum ficheiro eleitoral alterado nesta fase (verificação textual)
for (const f of ['src/hooks/useVoting.ts', 'src/hooks/useVoteAdjustments.ts', 'src/hooks/usePublishedResults.ts']) {
  const p = join(root, f);
  if (existsSync(p)) {
    const c = readFileSync(p, 'utf8');
    check(`${f} sem referência a modalidades (electoral intacto)`, !/award_modalit|award_distinction/i.test(c));
  }
}

if (failures > 0) {
  console.error(`\n5C.3.8 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n5C.3.8 VERIFY: tudo válido (local, sem banco remoto alterado).');
