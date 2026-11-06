#!/usr/bin/env node
// Offline safety regression tests. Does NOT connect to a database or execute SQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, 'docs/audits/proposals/category-area-repair.sql');
const sql = readFileSync(path, 'utf8');
const checks = [
  ['transaction begins and commits', /^begin;[\s\S]*commit;\s*$/im.test(sql)],
  ['only categories update', (sql.match(/\bupdate\s+public\.[a-z_]+/gi) ?? []).length === 1 && /update\s+public\.categories\s+c/i.test(sql)],
  ['only area_id assigned', /set\s+area_id\s*=\s*a\.id/i.test(sql)],
  ['program scoped', /p\.slug\s*=\s*'melhores-do-ano-portugal'/i.test(sql) && /c\.award_program_id\s*=\s*v_program/i.test(sql)],
  ['three explicit categories', ['cafes', 'ginasios', 'saloes-de-beleza'].every(s => sql.includes("'"+s+"'"))],
  ['three explicit target areas', ['restauracao-gastronomia', 'saude-bem-estar', 'beleza-estetica'].every(s => sql.includes("'"+s+"'"))],
  ['fail closed on missing categories', /esperadas 3 categorias/.test(sql)],
  ['fail closed on missing areas', /esperadas 3 areas/.test(sql)],
  ['fail closed on unexpected mapping', /area inesperada/.test(sql)],
  ['idempotent area assignment', /c\.area_id\s+is\s+distinct\s+from\s+a\.id/i.test(sql)],
  ['final validation', /validacao final falhou/.test(sql)],
  ['no delete, truncate or drop', !/\b(delete\s+from|truncate|drop\s+(table|schema))\b/i.test(sql)],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log((ok ? 'OK' : 'FAIL') + ' ' + label);
  if (!ok) failed++;
}
console.log(`${checks.length - failed}/${checks.length} verificações estáticas aprovadas`);
if (failed) process.exitCode = 1;
