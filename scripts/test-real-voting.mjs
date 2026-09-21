/**
 * Prémios Melhores do Ano Portugal — BACKEND REAL
 * Teste de votação ponta-a-ponta contra o Supabase conectado.
 *
 * Usa dados de teste identificáveis e seguros (prefixo CODEIN_E2E_) e
 * remove-os no fim quando for seguro fazê-lo.
 *
 * Casos (Passo 10):
 *  1. leitura pública permitida
 *  2. INSERT anónimo direto em votes → DEVE FALHAR
 *  3. Edge Function cast-vote acessível
 *  4. primeiro voto válido
 *  5. segundo voto mesmo campaign/city/category/IP → BLOQUEADO
 *  6. voto noutra categoria → PERMITIDO
 *  7. campaign inativa → BLOQUEADO
 *  8. campaign_entry inválida → BLOQUEADO
 *
 * Pré-requisitos: migrations 0001–0007 aplicadas + cast-vote deployed +
 * VOTE_HASH_SECRET configurado. Requer SUPABASE_SERVICE_ROLE_KEY no ambiente.
 *
 * Uso:
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role>"
 *   node scripts/test-real-voting.mjs [--cleanup]
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.SUPABASE_URL ?? 'https://agtgtcnwfrskvpegxoir.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON || !SERVICE) {
  console.error('PARE — definir SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  console.error('Nunca colocar estas chaves no Git nem no frontend (VITE_* só usa anon).');
  process.exit(2);
}

const anon = createClient(SUPA_URL, ANON);
const svc = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
const TAG = `CODEIN_E2E_${Date.now().toString(36).toUpperCase()}`;

async function callEdge(entryId) {
  const res = await fetch(`${SUPA_URL}/functions/v1/cast-vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ campaign_entry_id: entryId, device_id: `e2e-${TAG}` }),
  });
  const body = await res.json().catch(() => ({}));
  return { http: res.status, ...body };
}

const results = [];
const t = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log(`E2E votação real (${TAG}) contra ${SUPA_URL}`);

// 1. leitura pública permitida
{
  const { error, data } = await anon.from('campaigns').select('id').limit(1);
  t('1. leitura pública permitida', !error, error?.message?.slice(0, 100) ?? `ok (${(data ?? []).length} linhas)`);
}

// 2. INSERT anónimo direto → FALHAR
{
  const { error } = await anon.from('votes').insert({
    campaign_id: '00000000-0000-0000-0000-000000000000',
    city_id: '00000000-0000-0000-0000-000000000000',
    category_id: '00000000-0000-0000-0000-000000000000',
    business_id: '00000000-0000-0000-0000-000000000000',
    ip_hash: 'e2e-probe',
  });
  t('2. INSERT anónimo direto em votes BLOQUEADO', Boolean(error), error?.message?.slice(0, 110) ?? 'PERMITIDO (!!!)');
}

// Setup: campanha/cidade/categorias/negócios de teste (service_role)
let campaignId = null;
let cityId = null;
let catA = null;
let catB = null;
let bizA = null;
let entryA = null;
let entryB = null;
let setupOk = true;
try {
  const { data: camp } = await svc.from('campaigns').insert({
    name: `${TAG} campanha`, slug: `e2e-${TAG.toLowerCase()}-camp`, year: 2099,
    status: 'votacao', results_public: false,
  }).select('id').single();
  campaignId = camp.id;
  const { data: city } = await svc.from('cities').insert({ name: `${TAG} cidade`, slug: `e2e-${TAG.toLowerCase()}-city`, active: true }).select('id').single();
  cityId = city.id;
  const { data: cA } = await svc.from('categories').insert({ name: `${TAG} cat A`, slug: `e2e-${TAG.toLowerCase()}-cata`, active: true }).select('id').single();
  const { data: cB } = await svc.from('categories').insert({ name: `${TAG} cat B`, slug: `e2e-${TAG.toLowerCase()}-catb`, active: true }).select('id').single();
  catA = cA.id;
  catB = cB.id;
  const { data: biz } = await svc.from('businesses').insert({ name: `${TAG} negócio`, slug: `e2e-${TAG.toLowerCase()}-biz`, city_id: cityId, active: true, verified: true }).select('id').single();
  bizA = biz.id;
  const { data: eA } = await svc.from('campaign_entries').insert({ campaign_id: campaignId, city_id: cityId, category_id: catA, business_id: bizA, active: true }).select('id').single();
  const { data: eB } = await svc.from('campaign_entries').insert({ campaign_id: campaignId, city_id: cityId, category_id: catB, business_id: bizA, active: true }).select('id').single();
  entryA = eA.id;
  entryB = eB.id;
  console.log(`  setup E2E ok: campaign=${campaignId} entryA=${entryA} entryB=${entryB}`);
} catch (e) {
  setupOk = false;
  t('setup E2E (service_role cria dados de teste)', false, e.message.slice(0, 160));
}

// 3. Edge acessível (qualquer resposta estruturada conta como acessível)
if (setupOk) {
  const r = await callEdge(entryA);
  const reachable = ['success', 'already_voted', 'campaign_closed', 'invalid_entry', 'rate_limited', 'captcha_failed', 'server_error'].includes(r.status);
  t('3. Edge Function cast-vote acessível', reachable, `HTTP ${r.http} status=${r.status}`);
  // 4. primeiro voto válido
  t('4. primeiro voto válido', r.status === 'success', `status=${r.status} ${r.message ?? ''}`);
  // 5. duplicado bloqueado
  const r2 = await callEdge(entryA);
  t('5. segundo voto mesma categoria BLOQUEADO', r2.status === 'already_voted', `status=${r2.status}`);
  // 6. outra categoria permitido
  const r3 = await callEdge(entryB);
  t('6. voto noutra categoria PERMITIDO', r3.status === 'success', `status=${r3.status}`);
  // 7. campaign inativa bloqueada
  await svc.from('campaigns').update({ status: 'encerrada' }).eq('id', campaignId);
  const r4 = await callEdge(entryB);
  t('7. campaign inativa BLOQUEADA', r4.status === 'campaign_closed', `status=${r4.status}`);
  // 8. entry inválida bloqueada
  const r5 = await callEdge('00000000-0000-0000-0000-000000000000');
  t('8. campaign_entry inválida BLOQUEADA', r5.status === 'invalid_entry', `status=${r5.status}`);
} else {
  for (const n of ['3. Edge Function cast-vote acessível', '4. primeiro voto válido', '5. segundo voto mesma categoria BLOQUEADO', '6. voto noutra categoria PERMITIDO', '7. campaign inativa BLOQUEADA', '8. campaign_entry inválida BLOQUEADA']) t(n, false, 'setup falhou');
}

// Cleanup (apenas dados TAG; votos de teste são removidos primeiro)
if (process.argv.includes('--cleanup') && campaignId) {
  console.log('\n[cleanup E2E — remover apenas dados TAG]');
  const q = async (table, col, val) => {
    const { error } = await svc.from(table).delete().eq(col, val);
    console.log(`  delete ${table}: ${error ? 'ERRO ' + error.message.slice(0, 100) : 'ok'}`);
  };
  await q('votes', 'campaign_id', campaignId);
  await q('vote_attempts', 'campaign_id', campaignId);
  await q('campaign_entries', 'campaign_id', campaignId);
  await svc.from('businesses').delete().eq('id', bizA);
  await svc.from('categories').delete().eq('id', catA);
  await svc.from('categories').delete().eq('id', catB);
  await svc.from('cities').delete().eq('id', cityId);
  await svc.from('campaigns').delete().eq('id', campaignId);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} testes E2E passaram.`);
process.exit(passed === results.length ? 0 : 1);
