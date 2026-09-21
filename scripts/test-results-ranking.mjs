/**
 * Prémios Melhores do Ano Portugal — FASE 4E
 * Testes do apuramento público de resultados reais (sem BD viva necessária).
 *
 * Cobre o contrato da fase:
 *  1. rank() de competição: 15–15–10 → posições 1, 1, 3
 *  2. vencedor único isolado (10–7–5 → 1, 2, 3 + soleWinner)
 *  3. empate triplo (5–5–5 → 1, 1, 1, sem vencedor exclusivo)
 *  4. estabilidade visual do desempate técnico (nome/slug)
 *  5. migration 0009 usa rank(), não row_number(), e filtra participantes válidos
 *  6. RPC não expõe hashes/antifraude/segredos
 *  7. páginas públicas fazem gate estrito por results_public (RPC nem chamada se false)
 *  8. nenhum SELECT directo em votes/vote_attempts nas páginas públicas
 *  9. estados loading/empty/not_public/error presentes nas páginas de resultados
 * 10. admin tem publicar/ocultar com confirmação + auditoria
 * 11. scripts/painel admin consistentes com a 0009 (ordens e documentação)
 * 12. verify-real-backend cobre a 4E só com leitura anon (sem push)
 *
 * Execução: `node scripts/test-results-ranking.mjs`
 * Critério: exit 0 = todos passaram; exit 1 = falhas.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- Contrato puro de ranking (espelha src/lib/results.ts) -----------------
function applyCompetitionRank(rows) {
  const sorted = [...rows].sort(
    (a, b) =>
      b.total_votes - a.total_votes ||
      a.business_name.localeCompare(b.business_name, 'pt-PT') ||
      a.business_slug.localeCompare(b.business_slug),
  );
  let rank = 0;
  let prev = -1;
  return sorted.map((r, i) => {
    if (r.total_votes !== prev) {
      rank = i + 1;
      prev = r.total_votes;
    }
    return { ...r, position: rank };
  });
}

const pos = (rows) => applyCompetitionRank(rows).map((r) => r.position).join(',');

// 1. Empate no topo: 15–15–10 → 1,1,3
check(
  'rank empate 15-15-10 resulta em 1,1,3',
  pos([
    { business_name: 'B', business_slug: 'b', total_votes: 15 },
    { business_name: 'A', business_slug: 'a', total_votes: 15 },
    { business_name: 'C', business_slug: 'c', total_votes: 10 },
  ]) === '1,1,3',
);

// 2. Sem empate: 10–7–5 → 1,2,3
{
  const ranked = applyCompetitionRank([
    { business_name: 'A', business_slug: 'a', total_votes: 10 },
    { business_name: 'B', business_slug: 'b', total_votes: 7 },
    { business_name: 'C', business_slug: 'c', total_votes: 5 },
  ]);
  const firstCount = ranked.filter((r) => r.position === 1).length;
  check(
    'sem empate declara 1,2,3 com vencedor único',
    ranked.map((r) => r.position).join(',') === '1,2,3' && firstCount === 1,
  );
}

// 3. Empate triplo: 5–5–5 → 1,1,1 sem vencedor exclusivo
{
  const ranked = applyCompetitionRank([
    { business_name: 'A', business_slug: 'a', total_votes: 5 },
    { business_name: 'B', business_slug: 'b', total_votes: 5 },
    { business_name: 'C', business_slug: 'c', total_votes: 5 },
  ]);
  const firstCount = ranked.filter((r) => r.position === 1).length;
  check(
    'empate triplo partilha o 1.º sem vencedor exclusivo',
    ranked.map((r) => r.position).join(',') === '1,1,1' && firstCount === 3,
  );
}

// 4. Estabilidade visual: empatados ordenados por nome, posição igual
{
  const ranked = applyCompetitionRank([
    { business_name: 'Navalha de Ouro', business_slug: 'navalha-de-ouro', total_votes: 15 },
    { business_name: 'Barbearia do Largo', business_slug: 'barbearia-do-largo', total_votes: 15 },
  ]);
  check(
    'desempate técnico é só visual (nome asc, mesma posição)',
    ranked[0].business_name === 'Barbearia do Largo' && ranked.map((r) => r.position).join(',') === '1,1',
  );
}

// --- Asserções estáticas sobre os ficheiros --------------------------------
const migration = read('supabase/migrations/0009_phase4e_real_results.sql');
const resultsLib = read('src/lib/results.ts');
const hook = read('src/hooks/usePublishedResults.ts');
const resultsPage = read('src/pages/public/ResultsPage.tsx');
const categoryResult = read('src/pages/public/CategoryResultPage.tsx');
const categoryPage = read('src/pages/public/CategoryPage.tsx');
const businessPage = read('src/pages/public/BusinessPage.tsx');
const cityPage = read('src/pages/public/CityPage.tsx');
const resultsAdmin = read('src/pages/admin/ResultsAdminPage.tsx');
const campaignsAdmin = read('src/pages/admin/CampaignsPage.tsx');

// 5. Migration usa rank() e filtra participantes válidos
// NOTA: as verificações de "ausência" incidem sobre o CORPO SQL da função
// (entre `as $$` e `$$;`) — o cabeçalho de comentários documenta
// propositadamente os termos proibidos (row_number, hashes) como contexto.
const sqlBodyMatch = migration.match(/as \$\$([\s\S]*?)\$\$/i);
const sqlBody = sqlBodyMatch ? sqlBodyMatch[1] : migration;
check('migration 0009 usa rank() para empates', /rank\(\)\s*over/i.test(sqlBody));
check(
  'migration 0009 não usa row_number() para posição pública',
  !/row_number\s*\(\s*\)\s*over/i.test(sqlBody),
  'row_number declarava falsos vencedores (0003)',
);
check(
  'migration 0009 exige campaign_entries.active=true',
  /campaign_entries[\s\S]{0,400}?active\s*=\s*true/i.test(sqlBody),
);
check(
  'migration 0009 filtra results_public=true (fail-closed)',
  /results_public\s*=\s*true/i.test(sqlBody),
);

// 6. Nada sensível na RPC (corpo SQL + lista de colunas retornadas)
for (const secret of ['ip_hash', 'device_hash', 'user_agent_hash', 'vote_attempts', 'service_role', 'VOTE_HASH_SECRET']) {
  check(`RPC pública não expõe ${secret}`, !sqlBody.includes(secret));
}

// 7. Gate estrito no frontend público
for (const [label, src] of [
  ['ResultsPage', resultsPage],
  ['CategoryResultPage', categoryResult],
  ['CategoryPage', categoryPage],
  ['BusinessPage', businessPage],
]) {
  check(
    `${label} publica só com results_public===true`,
    src.includes('results_public === true'),
  );
}
check(
  'hook nem chama a RPC quando não publicado',
  hook.includes('if (!enabled) return []'),
);
check(
  'CityPage/HomePage não mostram contagens sem publicação',
  cityPage.includes('results_public === true') && !/total_votes/.test(cityPage),
);

// 8. Páginas públicas sem SELECT directo em votes/vote_attempts
for (const [label, src] of [
  ['ResultsPage', resultsPage],
  ['CategoryResultPage', categoryResult],
  ['CategoryPage', categoryPage],
  ['BusinessPage', businessPage],
  ['CityPage', cityPage],
]) {
  check(
    `${label} sem acesso directo a votes/vote_attempts`,
    !src.includes("from('votes'") && !src.includes('from("votes"') && !src.includes("from('vote_attempts'"),
  );
}

// 9. Estados de interface nas páginas de resultados
for (const [label, src] of [
  ['ResultsPage', resultsPage],
  ['CategoryResultPage', categoryResult],
]) {
  check(`${label} tem estado loading`, src.includes('PageLoading'));
  check(`${label} tem estado vazio/apuramento`, src.includes('EmptyState') || src.includes('apuramento'));
  check(
    `${label} tem estado não-publicado`,
    src.includes('ainda não publicados') || src.includes('ainda não publicados'.replace('ainda', 'ainda')),
  );
  check(`${label} tem estado de erro com retry`, src.includes('refetch'));
}
check(
  'empate exibido sem vencedor exclusivo (1.º, 1.º, 3.º)',
  resultsPage.includes('Empate no 1.º lugar') && categoryResult.includes('Empate no 1.º lugar'),
);
check(
  'selo verificado visível no ranking público',
  resultsPage.includes('business_verified') && categoryResult.includes('business_verified'),
);
check('lib documenta regra de empate sem inventar desempate', /sem regra de (negócio|desempate)/i.test(resultsLib));

// 10. Admin: publicar/ocultar com confirmação e auditoria
check(
  'admin publica com confirmação',
  campaignsAdmin.includes("transition(r, r.results_public ? 'unpublish' : 'publish')") &&
    campaignsAdmin.includes('window.confirm(`Publicar resultados'),
);
check('admin oculta com confirmação', campaignsAdmin.includes('window.confirm(`Ocultar resultados'));
check(
  'publicação/ocultação auditadas',
  campaignsAdmin.includes('results.publish') && campaignsAdmin.includes('results.unpublish'),
);
check(
  'admin mostra autoridade results_public + alerta de empate',
  resultsAdmin.includes('campaigns.results_public') && resultsAdmin.includes('Empate no 1.º lugar'),
);

// 11. Consistência operacional da 0009 (sem executar nada remoto)
const applyScript = read('scripts/apply-migrations.mjs');
const securityAdmin = read('src/pages/admin/SecurityAdminPage.tsx');
const settingsAdmin = read('src/pages/admin/SettingsAdminPage.tsx');
check(
  'apply-migrations inclui a 0009 por ordem (sem execução automática)',
  applyScript.includes("'0009_phase4e_real_results.sql'") &&
    applyScript.indexOf("'0008_realtime_publication.sql'") < applyScript.indexOf("'0009_phase4e_real_results.sql'"),
);
check(
  'painel Segurança documenta rank() e participantes válidos',
  securityAdmin.includes('rank()') && securityAdmin.includes('campaign_entries active'),
);
check(
  'Configurações declara campaigns.results_public como autoridade',
  settingsAdmin.includes('campaigns.results_public') && settingsAdmin.includes('não publica sozinho'),
);

// 12. Verificação viva da 4E: só leitura anon, sem push nem deploy
const verifyBackend = read('scripts/verify-real-backend.mjs');
check(
  'verify-real-backend testa get_published_results via anon',
  verifyBackend.includes("anon.rpc('get_published_results')"),
);
check(
  'verify-real-backend exige fail-closed (0 linhas se nada publicado)',
  verifyBackend.includes('fail-closed') && verifyBackend.includes('!anyPublished'),
);
check(
  'verify-real-backend rejeita colunas sensíveis e valida rank()',
  verifyBackend.includes('ip_hash') && verifyBackend.includes('rankMismatch'),
);
check(
  'verify-real-backend não faz push/deploy (só SELECT/RPC de leitura)',
  !/db push|supabase functions deploy|psql/i.test(verifyBackend),
);

console.log(`\n${passed} passaram, ${failed} falharam.`);
process.exit(failed === 0 ? 0 : 1);
