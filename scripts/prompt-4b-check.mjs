/**
 * PROMPT 4B — BACKEND ONLY (read-only).
 *
 * Verifica contra o Supabase REAL (ref agtgtcnwfrskvpegxoir), sem modificar nada:
 *  - PASSO 1: acessibilidade das 8 tabelas do cast-vote
 *  - PASSO 4: turnstile_enabled == false (via service_role quando disponível)
 *  - PASSO 5/6: CODE EXISTS / DEPLOYED / REACHABLE da Edge Function cast-vote
 *
 * NÃO cria migrations, NÃO altera tabelas/RLS, NÃO toca em frontend,
 * NÃO implementa funcionalidades, NÃO escreve no banco.
 *
 * Uso:
 *   $env:SUPABASE_URL="https://agtgtcnwfrskvpegxoir.supabase.co"
 *   $env:SUPABASE_ANON_KEY="<anon>"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role>"
 *   node scripts/prompt-4b-check.mjs
 *
 * Exit 0 = passos verificáveis OK; exit 1 = pendências (ver JSON final).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(key) {
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(join(root, f), 'utf8');
      const m = txt.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (m) return m[1].trim().replace(/^"|"$/g, '');
    } catch { /* ignora */ }
  }
  return '';
}

const SUPA_URL = (process.env.SUPABASE_URL ?? readEnvFile('SUPABASE_URL') ?? 'https://agtgtcnwfrskvpegxoir.supabase.co').trim();
const ANON = (process.env.SUPABASE_ANON_KEY ?? readEnvFile('VITE_SUPABASE_ANON_KEY') ?? '').trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

const REQUIRED_TABLES = [
  'campaigns',
  'cities',
  'categories',
  'businesses',
  'campaign_entries',
  'votes',
  'vote_attempts',
  'site_settings',
];

async function restHead(table, key) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 160) };
}

const out = {
  project_ref: 'agtgtcnwfrskvpegxoir',
  supabase_url: SUPA_URL,
  passo1_tables: {},
  passo4_turnstile: null,
  passo5_code_exists: false,
  passo5_deployed: false,
  passo6_reachable: false,
  passo6_detail: '',
};

console.log(`PROMPT 4B check → ${SUPA_URL}`);

// PASSO 1 — apenas leitura (service_role quando disponível, senão anon).
console.log('\n[PASSO 1 — tabelas do cast-vote]');
const probeKey = SERVICE || ANON;
for (const t of REQUIRED_TABLES) {
  try {
    const r = await restHead(t, probeKey);
    const accessible = r.status === 200 || r.status === 206;
    out.passo1_tables[t] = accessible ? `ACCESSIBLE (HTTP ${r.status})` : `INACCESSIBLE (HTTP ${r.status})`;
    console.log(`  ${t}: ${out.passo1_tables[t]}`);
  } catch (e) {
    out.passo1_tables[t] = `ERROR ${String(e.message).slice(0, 100)}`;
    console.log(`  ${t}: ${out.passo1_tables[t]}`);
  }
}

// PASSO 4 — turnstile_enabled deve ser false; leitura via REST com service_role.
console.log('\n[PASSO 4 — turnstile]');
if (!SERVICE) {
  out.passo4_turnstile = 'UNKNOWN (sem service_role neste ambiente)';
  console.log(`  ${out.passo4_turnstile} — esperado: turnstile_enabled=false`);
} else {
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/site_settings?select=key,value&key=in.(turnstile_enabled)`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    const data = await res.json();
    const flag = Array.isArray(data) ? data.find((r) => r.key === 'turnstile_enabled')?.value : null;
    out.passo4_turnstile = `turnstile_enabled=${JSON.stringify(flag)} (HTTP ${res.status})`;
    console.log(`  ${out.passo4_turnstile} — esperado: false`);
  } catch (e) {
    out.passo4_turnstile = `ERROR ${String(e.message).slice(0, 100)}`;
    console.log(`  ${out.passo4_turnstile}`);
  }
}

// PASSO 5/6 — CODE EXISTS (disco) / DEPLOYED (não-404) / REACHABLE (resposta estruturada).
console.log('\n[PASSO 5/6 — cast-vote]');
out.passo5_code_exists = existsSync(join(root, 'supabase', 'functions', 'cast-vote', 'index.ts'));
try {
  const r = await fetch(`${SUPA_URL}/functions/v1/cast-vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({}),
  });
  const body = await r.text();
  out.passo5_deployed = r.status !== 404;
  out.passo6_reachable = out.passo5_deployed && /status|message/.test(body);
  out.passo6_detail = `HTTP ${r.status} ${body.slice(0, 160)}`;
  console.log(`  CODE EXISTS=${out.passo5_code_exists} DEPLOYED=${out.passo5_deployed} REACHABLE=${out.passo6_reachable} :: ${out.passo6_detail}`);
} catch (e) {
  out.passo6_detail = `fetch falhou: ${String(e.message).slice(0, 120)}`;
  console.log(`  CODE EXISTS=${out.passo5_code_exists} :: ${out.passo6_detail}`);
}

console.log('\nRESULT_JSON ' + JSON.stringify(out));

const passo1Ok = REQUIRED_TABLES.every((t) => String(out.passo1_tables[t]).startsWith('ACCESSIBLE'));
const failed = !passo1Ok || !out.passo5_code_exists || !out.passo5_deployed || !out.passo6_reachable;
process.exit(failed ? 1 : 0);
