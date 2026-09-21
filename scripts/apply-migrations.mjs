/**
 * Prémios Melhores do Ano Portugal — BACKEND REAL
 * Aplica as migrations 0001–0009 ao Supabase conectado, POR ORDEM, e PÁRA
 * na primeira falha com o erro real, objeto SQL e solução recomendada.
 *
 * NÃO recria, NÃO duplica, NÃO edita migrations antigas.
 * NÃO apaga dados (ficheiros são IF NOT EXISTS / idempotentes).
 *
 * Uso:
 *   1. Obter a DATABASE_URL com password real (Dashboard > Settings > Database):
 *      $env:DATABASE_URL="postgresql://postgres:***@db.agtgtcnwfrskvpegxoir.supabase.co:5432/postgres"
 *   2. node scripts/apply-migrations.mjs
 *   Alternativa sem CLI: colar cada ficheiro por ordem no SQL Editor do Dashboard.
 *
 * Ordem fixa:
 *   0001_phase1_schema.sql → 0002_phase1_hardening.sql → 0003_published_results.sql
 *   → 0004_audit_insert_policy.sql → 0005_phase2_voting_engine.sql
 *   → 0006_phase3_admin_governance.sql → 0007_site_settings_public_lockdown.sql
 *   → 0008_realtime_publication.sql → 0009_phase4e_real_results.sql
 *
 * NOTA FASE 4E: este script NÃO é executado automaticamente. A migration
 * 0009 só é aplicada com autorização explícita (Passo 14).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');

const ORDER = [
  '0001_phase1_schema.sql',
  '0002_phase1_hardening.sql',
  '0003_published_results.sql',
  '0004_audit_insert_policy.sql',
  '0005_phase2_voting_engine.sql',
  '0006_phase3_admin_governance.sql',
  '0007_site_settings_public_lockdown.sql',
  '0008_realtime_publication.sql',
  '0009_phase4e_real_results.sql',
];

function guessObject(errText) {
  const m =
    errText.match(/relation "([^"]+)"/) ||
    errText.match(/table "([^"]+)"/) ||
    errText.match(/function ([a-z_.]+\([^)]*\))/i) ||
    errText.match(/policy "([^"]+)" on table "([^"]+)"/);
  return m ? m[0] : 'objeto não identificado (ver mensagem completa acima)';
}

function recommend(errText) {
  if (/already exists/i.test(errText))
    return 'Objeto já existe: seguro ignorar SE a migration for idempotente (IF NOT EXISTS / DROP IF EXISTS). Verificar se a re-execução parcial deixou o resto por aplicar; nesse caso continuar a partir daqui.';
  if (/permission denied/i.test(errText))
    return 'Permissão negada: executar como postgres owner (usar a connection string com a password do projeto, não a pooler sem privilégios).';
  if (/audit_logs é imutável/i.test(errText))
    return 'Trigger audit_no_update a bloquear: a migration está a tentar UPDATE/DELETE em audit_logs — rever o SQL (migrations oficiais nunca o fazem).';
  if (/PHASE3_GUARD/i.test(errText))
    return 'Guarda Phase 3: existe histórico de votos ligado ao objeto — arquivar/desactivar em vez de eliminar.';
  if (/password authentication failed|connection/i.test(errText))
    return 'Falha de ligação: confirmar DATABASE_URL com password real do Dashboard > Settings > Database.';
  return 'Corrigir a causa indicada pelo Postgres, SEM editar a migration antiga; se for preciso ajuste, criar uma nova migration 0010_* aditiva.';
}

console.log('=== Aplicar migrations ao backend REAL (ordem fixa) ===');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
console.log('Ficheiros no disco:', files.join(', '));

const missing = ORDER.filter((f) => !files.includes(f));
if (missing.length > 0) {
  console.error('FALTA(m) ficheiro(s) esperado(s):', missing.join(', '));
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl || dbUrl.includes('[YOUR-PASSWORD]') || dbUrl.includes('[ref]')) {
  console.error('\nPARE — DATABASE_URL com password real não configurada.');
  console.error('A DDL (CREATE TABLE/POLICY/FUNCTION) não pode ser aplicada via REST/anon key.');
  console.error('\nAÇÃO MANUAL NECESSÁRIA (1 min por ficheiro):');
  console.error('  Dashboard Supabase (melhores-do-ano-portugal) > SQL Editor > New query,');
  console.error('  colar e correr POR ORDEM:');
  for (const f of ORDER) console.error(`    ${f}`);
  console.error('  Depois: node scripts/verify-real-backend.mjs');
  process.exit(2);
}

// Verificar psql disponível
const check = spawnSync('psql', ['--version'], { encoding: 'utf8' });
if (check.error || check.status !== 0) {
  console.error('\nPARE — `psql` não encontrado no PATH e DATABASE_URL foi fornecida.');
  console.error('Instalar PostgreSQL client ou usar o SQL Editor (ver instruções acima).');
  process.exit(3);
}

for (const f of ORDER) {
  const sql = readFileSync(join(dir, f), 'utf8');
  console.log(`\n--- A aplicar ${f} (${sql.length} chars) ---`);
  const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', join(dir, f)], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    const errText = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.trim();
    console.error(`\nPARE — migration FALHOU: ${f}`);
    console.error(`ERRO REAL:\n${errText.slice(0, 2000)}`);
    console.error(`OBJETO SQL: ${guessObject(errText)}`);
    console.error(`SOLUÇÃO RECOMENDADA: ${recommend(errText)}`);
    console.error('NÃO continuei para as seguintes (ordem bloqueada).');
    process.exit(4);
  }
  console.log(`OK — ${f} aplicada.`);
  void sql;
}

console.log('\nTodas as migrations 0001–0009 aplicadas (ou já existiam, idempotente).');
console.log('Seguinte: node scripts/verify-real-backend.mjs');
