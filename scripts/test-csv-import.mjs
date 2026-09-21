/**
 * Prémios Melhores do Ano Portugal — Phase 3
 * Teste do workflow de importação CSV (src/lib/csv.ts).
 *
 * Compila os módulos TS reais para JS temporário e valida:
 *  - linhas válidas passam sem erros;
 *  - linhas inválidas são rejeitadas com erros por linha (sem excepções);
 *  - duplicados no ficheiro são detectados;
 *  - duplicados contra a BD geram aviso (upsert, sem registos corruptos);
 *  - cidades/categorias desconhecidas geram aviso (nada criado em silêncio);
 *  - delimitador `;` e modelo CSV_TEMPLATE são suportados.
 *
 * Uso: npm run test:csv
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// 1. Compilar os módulos reais (sem tocar no código-fonte).
// O output fica dentro do projecto para que `clsx`/`tailwind-merge` resolvam via node_modules.
// eslint-disable-next-line no-underscore-dangle
const workdir = mkdtempSync(join(root, 'scripts', '.tmp-csv-test-'));
try {
  execSync(
    `npx tsc src/lib/utils.ts src/lib/csv.ts --outDir "${workdir}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
    { stdio: 'pipe', cwd: root },
  );
} catch (e) {
  console.log('FAIL  compilação dos módulos csv/utils');
  console.log(String(e.stdout ?? e.message).slice(0, 2000));
  process.exit(1);
}
// O package é "type": "module", logo os .js compilados seriam tratados como
// ESM — renomeia-se para .cjs (CommonJS real) e corrige-se o require interno.
for (const base of ['utils', 'csv']) renameSync(join(workdir, `${base}.js`), join(workdir, `${base}.cjs`));
const csvEntry = join(workdir, 'csv.cjs');
writeFileSync(csvEntry, readFileSync(csvEntry, 'utf8').replace(/require\("\.\/utils"\)/g, 'require("./utils.cjs")'));
const csv = require(csvEntry);
const { parseCsv, validateRows, CSV_TEMPLATE, CSV_HEADERS } = csv;

// Garante que o directório temporário nunca fica para trás, mesmo em falha abrupta.
process.on('uncaughtException', (e) => {
  try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignora */ }
  console.log(`FAIL  excepção não tratada: ${String(e && e.message ? e.message : e).slice(0, 300)}`);
  process.exit(1);
});

const cityNames = new Map([['braga', 'city-braga'], ['porto', 'city-porto']]);
const categoryNames = new Map([['barbearias', 'cat-barbearias'], ['restaurantes', 'cat-restaurantes']]);
const existingSlugs = new Set(['barbearia-existente']);

// 2. Lote válido.
const validFile = [
  'business_name,city,category,description,website,instagram,facebook,google_maps_url,phone,email,address',
  '"Barbearia do Largo",Braga,Barbearias,"Corte clássico",https://barbearia.pt,https://instagram.com/x,https://facebook.com/x,https://maps.google.com/?q=a,+351 253 000 001,geral@barbearia.pt,"Rua A, Braga"',
  '"Cantinho do Avô",Porto,Restaurantes,"Cozinha tradicional",,,,,,,,"Rua B, Porto"',
].join('\n');
const parsed = parseCsv(validFile);
check('cabeçalhos reconhecidos', CSV_HEADERS.every((h) => parsed.headers.includes(h)), parsed.headers.join(','));
check('2 linhas válidas analisadas', parsed.rows.length === 2);
const validated = validateRows(parsed.rows, { existingSlugs, cityNames, categoryNames });
check('linhas válidas sem erros', validated.every((r) => r.errors.length === 0), JSON.stringify(validated.map((r) => r.errors)));
check('slug gerado correctamente', validated[0].slug === 'barbearia-do-largo', validated[0].slug);

// 3. Lote inválido: cada linha má gera erros localizados, sem excepções.
const invalidFile = [
  'business_name,city,category,description,website,instagram,facebook,google_maps_url,phone,email,address',
  ',Braga,Barbearias,"Sem nome",,,,,,,,"Rua X"',
  '"Nome Mau",,Barbearias,"Sem cidade",,,,,,,,"Rua X"',
  '"Nome Mau 2",Braga,,"Sem categoria",,,,,,,,"Rua X"',
  '"Email Mau",Braga,Barbearias,"Email inválido",,,,,,not-an-email,"Rua X"',
  '"Site Mau",Braga,Barbearias,"URL inválido",ht!tp://[ mau,,,,,,,"Rua X"',
  '"Duplicada",Braga,Barbearias,"Primeira",,,,,,,,"Rua 1"',
  '"Duplicada",Braga,Barbearias,"Segunda (duplicado no ficheiro)",,,,,,,,"Rua 2"',
].join('\n');
const bad = validateRows(parseCsv(invalidFile).rows, { existingSlugs, cityNames, categoryNames });
check('7 linhas analisadas', bad.length === 7, String(bad.length));
check('nome em falta rejeitado', bad[0].errors.some((e) => e.includes('business_name')));
check('cidade em falta rejeitada', bad[1].errors.some((e) => e.includes('city')));
check('categoria em falta rejeitada', bad[2].errors.some((e) => e.includes('category')));
check('email inválido rejeitado', bad[3].errors.some((e) => e.includes('Email')));
check('URL inválido rejeitado', bad[4].errors.some((e) => e.includes('Website')));
check('primeira ocorrência do duplicado passa', bad[5].errors.length === 0, bad[5].errors.join(' '));
check('duplicado no ficheiro rejeitado', bad[6].errors.some((e) => e.includes('Duplicado')));

// 4. Duplicado contra a BD → aviso (upsert), nunca erro silencioso nem duplo registo.
const dupDb = validateRows(parseCsv(
  'business_name,city,category\n"Barbearia Existente",Braga,Barbearias',
).rows, { existingSlugs, cityNames, categoryNames });
check('slug existente gera aviso de actualização', dupDb[0].errors.length === 0 && dupDb[0].warnings.some((w) => w.includes('actualizado')), JSON.stringify(dupDb[0]));

// 5. Cidade/categoria desconhecidas → aviso, importação bloqueia depois (sem registos corruptos).
const unknown = validateRows(parseCsv(
  'business_name,city,category\n"Nova Loja",Faro,Sushi',
).rows, { existingSlugs, cityNames, categoryNames });
check('cidade desconhecida gera aviso', unknown[0].warnings.some((w) => w.includes('Cidade')));
check('categoria desconhecida gera aviso', unknown[0].warnings.some((w) => w.includes('Categoria')));

// 6. Delimitador `;` + modelo oficial.
const semi = parseCsv('business_name;city;category\n"Loja A";Braga;Barbearias');
check('delimitador ponto-e-vírgula suportado', semi.rows.length === 1 && semi.rows[0].values.business_name === 'Loja A');
const tpl = parseCsv(CSV_TEMPLATE);
check('modelo CSV_TEMPLATE válido', tpl.rows.length === 1 && validateRows(tpl.rows, { existingSlugs, cityNames, categoryNames })[0].errors.length === 0);

rmSync(workdir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total.`);
process.exit(failed > 0 ? 1 : 0);
