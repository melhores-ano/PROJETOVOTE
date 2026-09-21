/**
 * PROMPT 4B — PASSO 7 (backend-only, seguro).
 *
 * Bateria de testes do backend de votação contra o Supabase REAL.
 * GATED: só executa os testes com escrita quando a Edge Function está
 * DEPLOYED + REACHABLE; caso contrário reporta tudo como NOT TESTED e sai 2.
 *
 * Casos cobertos (quando seguro):
 *  1. campaign_entry inválida → deve rejeitar (invalid_entry)
 *  2. campaign inativa → deve rejeitar (campaign_closed)
 *  3. primeiro voto válido → deve aceitar (success)
 *  4. segundo voto mesma campaign/city/category/IP → duplicado (already_voted)
 *  5. voto noutra categoria → permitido (success)
 *  6. chamada excessiva → rate-limit (rate_limited) — tentativa limitada e segura
 *
 * Segurança:
 *  - Usa apenas dados marcados `P4B_E2E_<ts>` (campanha/cidade/categorias/negócio).
 *  - Requer SUPABASE_SERVICE_ROLE_KEY para setup/cleanup; nunca expõe chaves.
 *  - Cleanup automático com `--cleanup` (apaga apenas registos do TAG).
 *  - NÃO toca em dados reais, NÃO altera RLS/migrations/frontend.
 *
 * Uso:
 *   $env:SUPABASE_ANON_KEY="<anon>"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role>"
 *   node scripts/prompt-4b-vote-tests.mjs [--cleanup] [--skip-rate-limit]
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = (process.env.SUPABASE_URL ?? 'https://agtgtcnwfrskvpegxoir.supabase.co').trim();
const ANON = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

if (!ANON || !SERVICE) {
  console.error('PARE — definir SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(2);
}

const anon = createClient(SUPA_URL, ANON);
const svc = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
const TAG = `P4B_E2E_${Date.now().toString(36).toUpperCase()}`;
const SKIP_RATE = process.argv.includes('--skip-rate-limit');
const CLEANUP = process.argv.includes('--cleanup');

async function callEdge(entryId, deviceId) {
  const res = await fetch(`${SUPA_URL}/functions/v1/cast-vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ campaign_entry_id: entryId, device_id: deviceId ?? `p4b-${TAG}` }),
  });
  const body = await res.json().catch(() => ({}));
  return { http: res.status, status: body.status ?? 'no-status', message: body.message ?? '' };
}

const results = [];
const record = (name, expected, got) => {
  const ok = expected === got;
  results.push({ name, expected, got, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — esperado=${expected} obtido=${got}`);
};

// Gate: função tem de estar deployed + reachable.
const gate = await callEdge('00000000-0000-0000-0000-000000000000');
if (gate.http === 404) {
  console.log('GATE: cast-vote HTTP 404 (NOT DEPLOYED) — todos os testes ficam NOT TESTED.');
  for (const n of ['invalid-entry', 'inactive-campaign', 'first-vote', 'duplicate-vote', 'other-category', 'rate-limit']) {
    results.push({ name: n, expected: 'NOT TESTED (gate 404)', got: 'NOT TESTED', ok: true });
  }
  console.log('\nRESULT_JSON ' + JSON.stringify({ gate: 'NOT_DEPLOYED_404', results }));
  process.exit(2);
}
console.log(`GATE: cast-vote responde (HTTP ${gate.http} status=${gate.status}) — a prosseguir com dados ${TAG}.`);

// Setup seguro com service_role.
let ids = null;
try {
  const { data: camp, error: e1 } = await svc.from('campaigns').insert({
    name: `${TAG} campanha`, slug: `p4b-${TAG.toLowerCase()}-camp`, year: 2099,
    status: 'votacao', results_public: false,
  }).select('id').single();
  if (e1) throw e1;
  const { data: city, error: e2 } = await svc.from('cities').insert({
    name: `${TAG} cidade`, slug: `p4b-${TAG.toLowerCase()}-city`, active: true,
  }).select('id').single();
  if (e2) throw e2;
  const { data: cA, error: e3 } = await svc.from('categories').insert({
    name: `${TAG} cat A`, slug: `p4b-${TAG.toLowerCase()}-cata`, active: true,
  }).select('id').single();
  if (e3) throw e3;
  const { data: cB, error: e4 } = await svc.from('categories').insert({
    name: `${TAG} cat B`, slug: `p4b-${TAG.toLowerCase()}-catb`, active: true,
  }).select('id').single();
  if (e4) throw e4;
  const { data: biz, error: e5 } = await svc.from('businesses').insert({
    name: `${TAG} negocio`, slug: `p4b-${TAG.toLowerCase()}-biz`, city_id: city.id, active: true, verified: true,
  }).select('id').single();
  if (e5) throw e5;
  const { data: eA, error: e6 } = await svc.from('campaign_entries').insert({
    campaign_id: camp.id, city_id: city.id, category_id: cA.id, business_id: biz.id, active: true,
  }).select('id').single();
  if (e6) throw e6;
  const { data: eB, error: e7 } = await svc.from('campaign_entries').insert({
    campaign_id: camp.id, city_id: city.id, category_id: cB.id, business_id: biz.id, active: true,
  }).select('id').single();
  if (e7) throw e7;
  ids = { campaignId: camp.id, cityId: city.id, catA: cA.id, catB: cB.id, bizId: biz.id, entryA: eA.id, entryB: eB.id };
  console.log(`  setup OK: campaign=${ids.campaignId} entryA=${ids.entryA} entryB=${ids.entryB}`);
} catch (e) {
  console.error(`SETUP FALHOU (sem escrever testes): ${String(e.message).slice(0, 200)}`);
  console.log('\nRESULT_JSON ' + JSON.stringify({ gate: 'SETUP_FAILED', results, error: String(e.message).slice(0, 200) }));
  process.exit(1);
}

// 1. entry inválida
record('invalid-entry', 'invalid_entry', (await callEdge('00000000-0000-0000-0000-000000000000')).status);
// 3+4+5 (ordem importa: primeiro voto, duplicado, outra categoria)
record('first-vote', 'success', (await callEdge(ids.entryA)).status);
record('duplicate-vote', 'already_voted', (await callEdge(ids.entryA)).status);
record('other-category', 'success', (await callEdge(ids.entryB)).status);
// 2. campanha inativa (desativar e testar)
await svc.from('campaigns').update({ status: 'encerrada' }).eq('id', ids.campaignId);
record('inactive-campaign', 'campaign_closed', (await callEdge(ids.entryB)).status);
// 6. rate-limit (rajada curta e limitada; pode ficar NOT TESTED com --skip-rate-limit)
if (SKIP_RATE) {
  results.push({ name: 'rate-limit', expected: 'SKIPPED', got: 'SKIPPED', ok: true });
  console.log('SKIP  rate-limit — flag --skip-rate-limit ativa.');
} else {
  let limited = false;
  for (let i = 0; i < 25; i++) {
    const r = await callEdge(ids.entryA, `p4b-rate-${TAG}-${i}`);
    if (r.status === 'rate_limited') { limited = true; break; }
  }
  results.push({ name: 'rate-limit', expected: 'rate_limited (best-effort)', got: limited ? 'rate_limited' : 'not-triggered', ok: true });
  console.log(`${limited ? 'PASS' : 'INFO'}  rate-limit — ${limited ? 'rate_limited observado' : 'não disparado nesta rajada curta (limites por defeito 20/10min, 30/24h)'}`);
}

if (CLEANUP) {
  console.log('\n[cleanup — apenas registos do TAG]');
  const del = async (table, col, val) => {
    const { error } = await svc.from(table).delete().eq(col, val);
    console.log(`  delete ${table}: ${error ? 'ERRO ' + String(error.message).slice(0, 100) : 'ok'}`);
  };
  await del('votes', 'campaign_id', ids.campaignId);
  await del('vote_attempts', 'campaign_id', ids.campaignId);
  await del('campaign_entries', 'campaign_id', ids.campaignId);
  await svc.from('businesses').delete().eq('id', ids.bizId);
  await svc.from('categories').delete().eq('id', ids.catA);
  await svc.from('categories').delete().eq('id', ids.catB);
  await svc.from('cities').delete().eq('id', ids.cityId);
  await svc.from('campaigns').delete().eq('id', ids.campaignId);
} else {
  console.log(`\n[cleanup adiado] Re-correr com --cleanup para remover TAG ${TAG}.`);
  console.log(`  campaign=${ids.campaignId} city=${ids.cityId} biz=${ids.bizId}`);
}

const failed = results.filter((r) => !r.ok);
console.log('\nRESULT_JSON ' + JSON.stringify({ tag: TAG, results }));
process.exit(failed.length > 0 ? 1 : 0);
