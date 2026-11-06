#!/usr/bin/env node
// Offline, read-only reconciliation. Requires an explicit history JSON snapshot.
// Never connects to Supabase or changes migrations.
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? null : process.argv[i + 1];
};
const historyFile = arg('--history');
const dir = resolve(arg('--dir') ?? resolve(root, 'supabase/migrations'));
if (!historyFile) {
  console.error('Uso: node scripts/reconcile-migration-history.mjs --history <snapshot.json> [--dir <pasta>]');
  process.exit(2);
}
let history;
try {
  history = JSON.parse(await readFile(resolve(historyFile), 'utf8'));
  if (!Array.isArray(history) || !history.every(x => x && typeof x.version === 'string' && typeof x.name === 'string')) throw new Error('Formato inválido');
} catch (error) {
  console.error('Histórico inválido:', error.message);
  process.exit(2);
}
const files = (await readdir(dir)).filter(x => x.endsWith('.sql')).sort();
const byVersion = new Map();
for (const file of files) {
  const m = /^(\d{4,})_(.+)\.sql$/.exec(file);
  if (!m) {
    console.log('NOME_INVALIDO', file);
    process.exitCode = 1;
    continue;
  }
  const entries = byVersion.get(m[1]) ?? [];
  entries.push({ file, name: m[2] });
  byVersion.set(m[1], entries);
}
const historyVersions = new Set();
for (const item of history) {
  if (historyVersions.has(item.version)) {
    console.log('HISTORICO_DUPLICADO', item.version);
    process.exitCode = 1;
  }
  historyVersions.add(item.version);
  const entries = byVersion.get(item.version) ?? [];
  if (!entries.length) {
    console.log('REMOTA_SEM_FICHEIRO', item.version, item.name);
    process.exitCode = 1;
  } else if (!entries.some(e => e.name === item.name)) {
    console.log('NOME_DIVERGENTE', item.version, item.name, entries.map(e => e.name).join(','));
    process.exitCode = 1;
  } else {
    console.log('REGISTADA', item.version, item.name);
  }
}
for (const [version, entries] of byVersion) {
  if (entries.length > 1) {
    console.log('COLISAO_LOCAL', version, entries.map(e => e.file).join(' | '));
    process.exitCode = 1;
  }
  if (!historyVersions.has(version)) console.log('NAO_REGISTADA', version, entries.map(e => e.file).join(' | '));
}
console.log('Ficheiros locais:', files.length, '| Versões locais:', byVersion.size, '| Versões no snapshot:', history.length);
console.log('NOTA: objetos existentes não provam aplicação integral. NÃO executar db push nem migration repair.');
