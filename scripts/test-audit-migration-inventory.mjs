#!/usr/bin/env node
// Offline regression tests. Creates only temporary fixture files; no database calls.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'audit-migration-inventory.mjs');
const temp = await mkdtemp(join(tmpdir(), 'projetovote-migrations-test-'));
const cases = [
  { name: 'valid', files: ['0001_base.sql', '0002_next.sql'], strict: true, code: 0, expected: 'Versões duplicadas: 0' },
  { name: 'duplicate', files: ['0014_one.sql', '0014_two.sql'], strict: true, code: 1, expected: 'DUPLICADA 0014:' },
  { name: 'duplicate-report', files: ['0014_one.sql', '0014_two.sql'], strict: false, code: 0, expected: 'DUPLICADA 0014:' },
  { name: 'invalid', files: ['bad.sql'], strict: true, code: 1, expected: 'NOME INVÁLIDO: bad.sql' },
];

try {
  for (const test of cases) {
    const dir = join(temp, test.name);
    await mkdir(dir);
    for (const name of test.files) await writeFile(join(dir, name), '-- fixture\n');
    const result = spawnSync(process.execPath, [script, '--dir', dir, ...(test.strict ? ['--strict'] : [])], { encoding: 'utf8' });
    assert.equal(result.status, test.code, `${test.name}: ${result.stderr} ${result.stdout}`);
    assert.ok(result.stdout.includes(test.expected), `${test.name}: ${result.stdout}`);
    console.log(`OK ${test.name}`);
  }
  console.log('4 testes de inventário concluídos.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
