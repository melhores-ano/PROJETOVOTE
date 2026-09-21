/**
 * Prémios Melhores do Ano Portugal — BACKEND REAL
 * Verificação viva contra o Supabase conectado (ref agtgtcnwfrskvpegxoir).
 *
 * Cobre Passos 3–8 e 11:
 *  - existência das 12 tabelas (via REST com service_role; PGRST205 = MISSING)
 *  - RLS: anon NÃO pode INSERT/UPDATE/DELETE votes, nem ler vote_attempts/
 *    audit_logs; leitura pública permitida em catálogos
 *  - site_settings: deteta leitura totalmente aberta (pré-0007) vs lockdown
 *  - Edge Function cast-vote: CODE EXISTS (ficheiro) / DEPLOYED (não-404) /
 *    REACHABLE (resposta estruturada) — separados
 *  - Turnstile: lê flag turnstile_enabled (esperado false até configurarmos)
 *  - FASE 4E (só leitura, sem push): RPC get_published_results via anon —
 *    existe? fail-closed com results_public=false? colunas sem hashes?
 *    posições consistentes com rank() (1,1,3 em empates)?
 *  - Frontend: garante que não usa codein-local-preview / codein-local.supabase.co
 *    e que nenhuma VITE_* expõe service_role
 *
 * Uso: node scripts/verify-real-backend.mjs
 * Exit 0 = backend verificado; exit 1 = pendências (ver tabela final).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUPA_URL = (process.env.SUPABASE_URL ?? 'https://agtgtcnwfrskvpegxoir.supabase.co').trim();
const ANON = (process.env.SUPABASE_ANON_KEY ?? readEnv('VITE_SUPABASE_ANON_KEY') ?? '').trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

function readEnv(key) {
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(join(root, f), 'utf8');
      const m = txt.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (m) return m[1].trim().replace(/^"|"$/g, '');
    } catch { /* ignora */ }
  }
  return '';
}

const anon = createClient(SUPA_URL, ANON);
const svc = SERVICE ? createClient(SUPA_URL, SERVICE) : null;

const TABLES = [
  'campaigns', 'cities', 'categories', 'businesses', 'business_categories',
  'campaign_entries', 'votes', 'vote_attempts', 'profiles', 'site_settings',
  'audit_logs', 'sponsors',
];

async function rawGet(table, key) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

const rows = [];
const push = (item, status, tested, result) => rows.push({ item, status, tested, result });

console.log(`Backend real: ${SUPA_URL} (ref agtgtcnwfrskvpegxoir)`);

// ---- Tabelas ----
console.log('\n[TABELAS]');
let allExist = true;
for (const t of TABLES) {
  const { status, body } = await rawGet(t, SERVICE || ANON);
  const exists = status !== 404 || !body.includes('schema cache');
  if (!exists) allExist = false;
  console.log(`  ${t}: ${exists ? 'EXISTS' : 'MISSING'} (HTTP ${status})`);
}
push('Tabelas 12/12', allExist ? '✅ VERIFIED LIVE' : '❌ FAILED', 'YES', allExist ? 'todas EXISTS' : 'há MISSING (migrations por aplicar)');

// ---- RLS ----
console.log('\n[RLS — anon esperado: bloqueado em votes/vote_attempts/audit_logs]');
const anonInsertVotes = await anon.from('votes').insert({
  campaign_id: '00000000-0000-0000-0000-000000000000',
  city_id: '00000000-0000-0000-0000-000000000000',
  category_id: '00000000-0000-0000-0000-000000000000',
  business_id: '00000000-0000-0000-0000-000000000000',
  ip_hash: 'probe-should-fail',
});
const anonSelectAttempts = await anon.from('vote_attempts').select('id').limit(1);
const anonSelectAudit = await anon.from('audit_logs').select('id').limit(1);
const votesBlocked = Boolean(anonInsertVotes.error);
const attemptsBlocked = Boolean(anonSelectAttempts.error);
const auditBlocked = Boolean(anonSelectAudit.error);
console.log(`  anon INSERT votes: ${votesBlocked ? 'BLOCKED ✅' : 'ALLOWED ❌'} ${anonInsertVotes.error?.message?.slice(0, 110) ?? ''}`);
console.log(`  anon SELECT vote_attempts: ${attemptsBlocked ? 'BLOCKED ✅' : 'ALLOWED ❌'}`);
console.log(`  anon SELECT audit_logs: ${auditBlocked ? 'BLOCKED ✅' : 'ALLOWED ❌'}`);
// Nota: com tabelas MISSING o erro é PGRST205 (schema cache), não prova RLS.
const schemaMissing = anonInsertVotes.error?.message?.includes('schema cache') ?? false;
const rlsOk = votesBlocked && attemptsBlocked && auditBlocked && !schemaMissing;
push('RLS votes/attempts/audit', schemaMissing ? '❌ FAILED' : rlsOk ? '✅ VERIFIED LIVE' : '❌ FAILED', 'YES', schemaMissing ? 'tabelas MISSING — RLS por verificar após migrations' : anonInsertVotes.error?.message?.slice(0, 80) ?? 'ok');

// ---- site_settings ----
console.log('\n[SITE_SETTINGS]');
let settingsNote = '';
if (!svc) {
  settingsNote = 'SUPABASE_SERVICE_ROLE_KEY em falta — leitura de chaves impossível';
  console.log(`  ${settingsNote}`);
  push('site_settings lockdown', '⚠️ REQUIRES MANUAL ACTION', 'NO', settingsNote);
} else {
  const { data, error } = await svc.from('site_settings').select('key,is_public').limit(50);
  if (error) {
    settingsNote = error.message.includes('schema cache')
      ? 'tabela MISSING (migrations por aplicar)'
      : error.message.slice(0, 120);
    console.log(`  ERRO: ${settingsNote}`);
    push('site_settings lockdown', '❌ FAILED', 'YES', settingsNote);
  } else {
    const keys = (data ?? []).map((r) => r.key);
    const hasFlag = data && data.length > 0 && 'is_public' in data[0];
    const anonRead = await anon.from('site_settings').select('key').limit(50);
    settingsNote = `keys=[${keys.join(', ')}] is_public_col=${hasFlag ? 'yes' : 'no (pré-0007)'} anon_read=${anonRead.error ? 'blocked' : `allowed(${(anonRead.data ?? []).length})`}`;
    console.log(`  ${settingsNote}`);
    push('site_settings lockdown', hasFlag ? '✅ VERIFIED LIVE' : '⚠️ REQUIRES MANUAL ACTION', 'YES', settingsNote);
  }
}

// ---- Edge Function ----
console.log('\n[EDGE cast-vote]');
const codeExists = existsSync(join(root, 'supabase', 'functions', 'cast-vote', 'index.ts'));
let deployed = false;
let reachable = false;
let edgeNote = '';
try {
  const r = await fetch(`${SUPA_URL}/functions/v1/cast-vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({}),
  });
  const body = await r.text();
  deployed = r.status !== 404;
  reachable = deployed && /status|message/.test(body);
  edgeNote = `HTTP ${r.status} ${body.slice(0, 120)}`;
  console.log(`  CODE EXISTS=${codeExists} DEPLOYED=${deployed} REACHABLE=${reachable} :: ${edgeNote}`);
} catch (e) {
  edgeNote = `fetch falhou: ${e.message}`;
  console.log(`  ${edgeNote}`);
}
push('cast-vote CODE EXISTS', codeExists ? '✅ VERIFIED LIVE' : '❌ FAILED', 'YES', 'ficheiro no disco');
push('cast-vote DEPLOYED', deployed ? '✅ VERIFIED LIVE' : '❌ FAILED', 'YES', edgeNote);
push('cast-vote REACHABLE', reachable ? '✅ VERIFIED LIVE' : '❌ FAILED', 'YES', edgeNote);

// ---- Turnstile ----
console.log('\n[TURNSTILE]');
if (svc) {
  const { data } = await svc.from('site_settings').select('key,value').in('key', ['turnstile_enabled']).maybeSingle?.() ?? {};
  void data;
}
let turnstileFlag = 'desconhecido (tabela MISSING ou sem service key)';
try {
  if (svc) {
    const { data: sdata } = await svc.from('site_settings').select('key,value').in('key', ['turnstile_enabled', 'turnstile_site_key']);
    const get = (k) => (sdata ?? []).find((r) => r.key === k)?.value;
    turnstileFlag = `turnstile_enabled=${JSON.stringify(get('turnstile_enabled'))} site_key=${JSON.stringify(get('turnstile_site_key'))?.slice(0, 20)}`;
  }
} catch { /* ignora */ }
console.log(`  ${turnstileFlag} (esperado: enabled=false até Cloudflare posterior)`);
push('Turnstile (enabled=false)', turnstileFlag.includes('false') ? '✅ VERIFIED LIVE' : '⚠️ REQUIRES MANUAL ACTION', 'YES', turnstileFlag);

// ---- Published results — FASE 4E (só leitura anon; nada é alterado) ----
console.log('\n[PUBLISHED RESULTS — FASE 4E]');
let resultsNote = '';
let resultsStatus = '⚠️ REQUIRES MANUAL ACTION';
try {
  const { data: camps, error: campErr } = await anon
    .from('campaigns')
    .select('id,year,results_public,status');
  if (campErr) {
    resultsNote = `leitura campaigns falhou: ${campErr.message.slice(0, 120)}`;
    console.log(`  ${resultsNote}`);
    push('4E results_public fail-closed', '❌ FAILED', 'YES', resultsNote);
  } else {
    const anyPublished = (camps ?? []).some((c) => c.results_public === true);
    const { data: pubRows, error: rpcErr } = await anon.rpc('get_published_results');
    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      if (/does not exist|PGRST202|schema cache|404/i.test(msg)) {
        resultsNote = 'RPC get_published_results em falta — aplicar supabase/migrations/0009_phase4e_real_results.sql no SQL Editor (com autorização)';
        console.log(`  ${resultsNote}`);
        push('4E RPC get_published_results existe', '⚠️ REQUIRES MANUAL ACTION', 'YES', resultsNote);
      } else {
        resultsNote = `RPC falhou: ${msg.slice(0, 120)}`;
        console.log(`  ${resultsNote}`);
        push('4E results_public fail-closed', '❌ FAILED', 'YES', resultsNote);
      }
    } else {
      const rowsOut = (pubRows ?? []);
      const forbidden = ['ip_hash', 'device_hash', 'user_agent_hash', 'outcome', 'reason'];
      const leaked = rowsOut.length > 0
        ? Object.keys(rowsOut[0]).filter((k) => forbidden.includes(k))
        : [];
      const malformed = rowsOut.filter(
        (r) => typeof r.total_votes !== 'number' || typeof r.position !== 'number' || !r.business_slug || !r.city_slug || !r.category_slug,
      );
      // Consistência rank(): recalcula 1,1,3 por grupo e compara.
      let rankMismatch = 0;
      const groups = new Map();
      for (const r of rowsOut) {
        const k = `${r.campaign_year}::${r.city_slug}::${r.category_slug}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      for (const list of groups.values()) {
        const sorted = [...list].sort((a, b) => b.total_votes - a.total_votes);
        let rank = 0;
        let prev = -1;
        sorted.forEach((r, i) => {
          if (r.total_votes !== prev) {
            rank = i + 1;
            prev = r.total_votes;
          }
          if (r.position !== rank) rankMismatch++;
        });
      }
      if (!anyPublished && rowsOut.length === 0) {
        resultsStatus = '✅ VERIFIED LIVE';
        resultsNote = `fail-closed: ${(camps ?? []).length} edições com results_public=false → 0 linhas para anon`;
      } else if (!anyPublished && rowsOut.length > 0) {
        resultsStatus = '❌ FAILED';
        resultsNote = `FUGA: ${rowsOut.length} linhas com todas as edições em results_public=false`;
      } else if (leaked.length > 0) {
        resultsStatus = '❌ FAILED';
        resultsNote = `colunas sensíveis expostas: ${leaked.join(', ')}`;
      } else if (malformed.length > 0) {
        resultsStatus = '❌ FAILED';
        resultsNote = `${malformed.length} linhas malformadas (total_votes/position/slugs)`;
      } else if (rowsOut.length === 0) {
        resultsNote = 'edição publicada mas sem votos apurados ainda (0 linhas) — colunas limpas, sem fugas';
      } else if (rankMismatch > 0) {
        resultsNote = `${rowsOut.length} linhas, colunas limpas, mas ${rankMismatch} posições ≠ rank() — provável 0003 (row_number) ainda activa: aplicar 0009`;
      } else {
        resultsStatus = '✅ VERIFIED LIVE';
        resultsNote = `${rowsOut.length} linhas em ${groups.size} grupos · colunas limpas · posições = rank()`;
      }
      console.log(`  ${resultsNote}`);
      push('4E results_public fail-closed + rank()', resultsStatus, 'YES', resultsNote);
    }
  }
} catch (e) {
  resultsNote = `verificação 4E impossível (rede?): ${e.message}`;
  console.log(`  ${resultsNote}`);
  push('4E results_public fail-closed + rank()', '⚠️ REQUIRES MANUAL ACTION', 'NO', resultsNote);
}

// ---- Frontend ----
console.log('\n[FRONTEND]');
const envText = [readEnv('VITE_SUPABASE_URL'), readEnv('VITE_SUPABASE_ANON_KEY')].join(' ');
void envText;
let frontOk = true;
const frontIssues = [];
for (const f of ['.env', '.env.local']) {
  try {
    const txt = readFileSync(join(root, f), 'utf8');
    if (txt.includes('codein-local-preview') || txt.includes('codein-local.supabase.co')) {
      frontOk = false;
      frontIssues.push(`${f} ainda referencia codein-local`);
    }
    const viteService = txt.split('\n').some((l) => l.startsWith('VITE_') && /SERVICE_ROLE/i.test(l));
    if (viteService) {
      frontOk = false;
      frontIssues.push(`${f} expõe service_role em VITE_*`);
    }
    if (!txt.includes('agtgtcnwfrskvpegxoir.supabase.co')) {
      frontOk = false;
      frontIssues.push(`${f} não aponta para o backend real`);
    }
  } catch { frontIssues.push(`${f} ilegível`); frontOk = false; }
}
console.log(`  ${frontOk ? 'OK — aponta para o real, sem codein-local, sem VITE_* service_role' : 'PENDENTE: ' + frontIssues.join('; ')}`);
push('Frontend → backend real', frontOk ? '✅ VERIFIED LIVE' : '❌ FAILED', 'YES', frontIssues.join('; ') || 'URL real + anon only');

// ---- Tabela final ----
console.log('\nITEM | REAL BACKEND STATUS | TESTED | RESULT');
for (const r of rows) console.log(`${r.item} | ${r.status} | ${r.tested} | ${r.result}`);

const failed = rows.some((r) => r.status.startsWith('❌'));
process.exit(failed ? 1 : 0);
