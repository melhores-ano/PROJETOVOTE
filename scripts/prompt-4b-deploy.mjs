/**
 * PROMPT 4B — PASSO 5 (backend-only).
 *
 * Helper de deploy da Edge Function `cast-vote` já existente.
 * NÃO reescreve a função, NÃO toca em frontend, migrations, tabelas ou RLS.
 *
 * Estratégia:
 *  1. Verifica CODE EXISTS no disco.
 *  2. Tenta `supabase functions deploy cast-vote --no-verify-jwt --project-ref <ref>`
 *     via CLI local (requer `supabase login` / SUPABASE_ACCESS_TOKEN).
 *  3. Se a CLI estiver sem permissões, imprime a ação manual exata e sai com
 *     código 2 (MANUAL ACTION REQUIRED) — nunca falha silenciosamente.
 *  4. Após o deploy, verifica DEPLOYED (não-404) e REACHABLE (resposta estruturada).
 *
 * Uso:
 *   node scripts/prompt-4b-deploy.mjs [--project-ref agtgtcnwfrskvpegxoir]
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const refIdx = args.indexOf('--project-ref');
const PROJECT_REF = refIdx >= 0 && args[refIdx + 1] ? args[refIdx + 1] : 'agtgtcnwfrskvpegxoir';
const SUPA_URL = (process.env.SUPABASE_URL ?? 'https://agtgtcnwfrskvpegxoir.supabase.co').trim();

const codeExists = existsSync(join(root, 'supabase', 'functions', 'cast-vote', 'index.ts'));
console.log(`[4B-deploy] CODE EXISTS=${codeExists}`);
if (!codeExists) {
  console.error('[4B-deploy] PARE — ficheiro supabase/functions/cast-vote/index.ts em falta.');
  process.exit(1);
}

console.log('[4B-deploy] A tentar deploy via Supabase CLI (requer login / SUPABASE_ACCESS_TOKEN)...');
const deploy = spawnSync(
  'supabase',
  ['functions', 'deploy', 'cast-vote', '--project-ref', PROJECT_REF, '--no-verify-jwt'],
  { encoding: 'utf8', cwd: root, timeout: 180000 },
);

if (deploy.stdout) console.log(deploy.stdout.slice(0, 2000));
if (deploy.stderr) console.log(deploy.stderr.slice(0, 2000));

if (deploy.error || deploy.status !== 0) {
  console.log('\n[4B-deploy] DEPLOY NÃO CONCLUÍDO NESTE AMBIENTE.');
  console.log('AÇÃO MANUAL NECESSÁRIA (owner, 2 comandos):');
  console.log('  supabase login');
  console.log(`  supabase secrets set VOTE_HASH_SECRET="<64+ hex aleatórios>" --project-ref ${PROJECT_REF}`);
  console.log(`  supabase functions deploy cast-vote --project-ref ${PROJECT_REF} --no-verify-jwt`);
  console.log('Nunca colocar o segredo em código, frontend, VITE_*, site_settings ou Git.');
  process.exit(2);
}

console.log('[4B-deploy] CLI reportou sucesso — a verificar endpoint real...');
try {
  const anon = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const r = await fetch(`${SUPA_URL}/functions/v1/cast-vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({}),
  });
  const body = await r.text();
  const deployed = r.status !== 404;
  const reachable = deployed && /status|message/.test(body);
  console.log(`[4B-deploy] DEPLOYED=${deployed} REACHABLE=${reachable} :: HTTP ${r.status} ${body.slice(0, 160)}`);
  process.exit(deployed && reachable ? 0 : 1);
} catch (e) {
  console.error(`[4B-deploy] Verificação falhou: ${String(e.message).slice(0, 160)}`);
  process.exit(1);
}
