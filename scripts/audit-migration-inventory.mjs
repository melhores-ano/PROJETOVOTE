#!/usr/bin/env node
/**
 * Read-only migration inventory. No database access, no environment secrets,
 * and no writes. Run: node scripts/audit-migration-inventory.mjs [--strict]
 *
 * --strict exits 1 on duplicate versions or malformed SQL migration filenames.
 * Default mode reports existing drift without failing the build.
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'supabase', 'migrations');
const strict = process.argv.includes('--strict');
const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
const versions = new Map();
const invalid = [];

for (const file of files) {
  const match = /^(\d{4,})_[a-zA-Z0-9_-]+\.sql$/.exec(file);
  if (!match) {
    invalid.push(file);
    continue;
  }
  const version = match[1];
  versions.set(version, [...(versions.get(version) ?? []), file]);
}

const duplicates = [...versions.entries()].filter(([, entries]) => entries.length > 1);
console.log('PROJETOVOTE — inventário local de migrations (somente leitura)');
console.log(`Ficheiros SQL: ${files.length}`);
console.log(`Versões distintas: ${versions.size}`);
console.log(`Versões duplicadas: ${duplicates.length}`);
for (const [version, entries] of duplicates) {
  console.log(`  DUPLICADA ${version}: ${entries.join(' | ')}`);
}
for (const file of invalid) {
  console.log(`  NOME INVÁLIDO: ${file}`);
}
if (duplicates.length === 0 && invalid.length === 0) {
  console.log('Sem anomalias de nomes/versões locais.');
}
if (strict && (duplicates.length > 0 || invalid.length > 0)) {
  process.exitCode = 1;
}
