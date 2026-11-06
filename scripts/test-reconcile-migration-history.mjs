#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'reconcile-migration-history.mjs');
const tmp = await mkdtemp(join(tmpdir(), 'migration-reconcile-'));
try {
  const cases = [
    { name: 'aligned', files: ['0001_base.sql'], history: [{version:'0001',name:'base'}], code:0, expected:'REGISTADA 0001' },
    { name: 'pending', files: ['0001_base.sql','0002_next.sql'], history:[{version:'0001',name:'base'}], code:0, expected:'NAO_REGISTADA 0002' },
    { name: 'collision', files:['0014_first.sql','0014_second.sql'], history:[{version:'0014',name:'first'}], code:1, expected:'COLISAO_LOCAL 0014' },
    { name: 'mismatch', files:['0001_base.sql'], history:[{version:'0001',name:'other'}], code:1, expected:'NOME_DIVERGENTE 0001' },
    { name: 'missing', files:['0002_next.sql'], history:[{version:'0001',name:'base'}], code:1, expected:'REMOTA_SEM_FICHEIRO 0001' },
    { name: 'history-duplicate', files:['0001_base.sql'], history:[{version:'0001',name:'base'},{version:'0001',name:'base'}], code:1, expected:'HISTORICO_DUPLICADO 0001' },
  ];
  for (const c of cases) {
    const dir=join(tmp,c.name); await mkdir(dir);
    for (const f of c.files) await writeFile(join(dir,f),'-- fixture\n');
    const hist=join(dir,'history.json'); await writeFile(hist,JSON.stringify(c.history));
    const r=spawnSync(process.execPath,[script,'--history',hist,'--dir',dir],{encoding:'utf8'});
    assert.equal(r.status,c.code,c.name+': '+r.stderr+' '+r.stdout);
    assert.ok(r.stdout.includes(c.expected),c.name+': '+r.stdout);
    console.log('OK',c.name);
  }
  console.log('6 testes offline de reconciliação concluídos.');
} finally { await rm(tmp,{recursive:true,force:true}); }
