/**
 * PROMPT 4B — PASSO 3 (backend-only, seguro).
 *
 * Helper para VOTE_HASH_SECRET SEM expor segredos:
 *  - NUNCA lê nem imprime o valor real configurado (Edge Secrets não têm
 *    leitura via REST/anon/service_role; só via Dashboard/CLI autenticada).
 *  - Gera LOCALMENTE um candidato criptograficamente forte (64 bytes → 128 hex)
 *    apenas quando solicitado com --generate, para o operador colar no mecanismo
 *    seguro de Supabase Edge Function Secrets.
 *  - NUNCA escreve em código, frontend, VITE_*, site_settings, .env ou Git.
 *  - Tenta apenas DETETAR indiretamente a presença via CLI `supabase secrets list`
 *    (requer login); sem login, reporta MANUAL ACTION REQUIRED.
 *
 * Uso seguro:
 *   node scripts/prompt-4b-secrets.mjs --status        # só diagnostica (não gera)
 *   node scripts/prompt-4b-secrets.mjs --generate      # gera candidato local (uma vez)
 *
 * Configuração real (owner, fora deste script):
 *   supabase login
 *   supabase secrets set VOTE_HASH_SECRET="<colar-candidato>" --project-ref agtgtcnwfrskvpegxoir
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);

if (args.includes('--generate')) {
  const candidate = randomBytes(64).toString('hex');
  console.log('Candidato VOTE_HASH_SECRET gerado LOCALMENTE (128 hex, 512 bits).');
  console.log('Cole AGORA no mecanismo seguro e descarte este terminal depois:');
  console.log(`\n  supabase secrets set VOTE_HASH_SECRET="${candidate}" --project-ref agtgtcnwfrskvpegxoir\n`);
  console.log('REGRAS: nunca cometer em Git, nunca pôr em VITE_*, site_settings ou ficheiros .env do frontend.');
  console.log('Relatório final deve dizer apenas: VOTE_HASH_SECRET: CONFIGURED (sem imprimir o valor).');
  process.exit(0);
}

// --status (por defeito): tenta deteção indireta via CLI autenticada.
console.log('[4B-secrets] A verificar presença de VOTE_HASH_SECRET via CLI (sem ler valores)...');
const r = spawnSync('supabase', ['secrets', 'list', '--project-ref', 'agtgtcnwfrskvpegxoir'], { encoding: 'utf8', timeout: 60000 });
const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
if (r.error || r.status !== 0) {
  console.log('[4B-secrets] CLI sem acesso neste ambiente (esperado sem `supabase login`).');
  if (/Access token not provided|supabase login/i.test(out)) {
    console.log('Causa: SUPABASE_ACCESS_TOKEN em falta.');
  }
  console.log('RESULT: VOTE_HASH_SECRET: MANUAL ACTION REQUIRED');
  console.log('Ação owner: Dashboard > Edge Functions > Secrets > VOTE_HASH_SECRET, ou:');
  console.log('  supabase login && supabase secrets set VOTE_HASH_SECRET="<forte>" --project-ref agtgtcnwfrskvpegxoir');
  process.exit(2);
}
const present = /VOTE_HASH_SECRET/.test(out);
console.log(`RESULT: VOTE_HASH_SECRET: ${present ? 'CONFIGURED (nome presente na lista)' : 'MANUAL ACTION REQUIRED (nome ausente)'}`);
process.exit(present ? 0 : 2);
