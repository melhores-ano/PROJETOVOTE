#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'apply-migrations.mjs');

function run(args, databaseUrl) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 5000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

// No test case connects to a database: each is rejected before psql.
const withoutConfirmation = run([], 'postgresql://user:pass@localhost:5432/test');
assert.equal(withoutConfirmation.status, 5);
assert.match(withoutConfirmation.stderr, /BLOQUEADO/);

const remote = run(['--confirm-legacy-replay'], 'postgresql://user:pass@db.example.org:5432/postgres');
assert.equal(remote.status, 8);
assert.match(remote.stderr, /base PostgreSQL local/);

const missing = run(['--confirm-legacy-replay'], '');
assert.equal(missing.status, 2);
assert.match(missing.stderr, /DATABASE_URL não configurada/);

const malformed = run(['--confirm-legacy-replay'], 'not-a-postgres-url');
assert.equal(malformed.status, 2);
assert.match(malformed.stderr, /DATABASE_URL inválida/);

console.log('OK: 4 testes de proteção do replay legado.');
