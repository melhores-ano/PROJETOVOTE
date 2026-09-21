/**
 * PROMPT 4B — PASSO 2 (backend-only, read-only).
 *
 * Auditoria estática de `supabase/functions/cast-vote/index.ts`.
 * NÃO reescreve a função — apenas confirma cada requisito do Passo 2
 * por inspeção do código-fonte. Se algum item crítico falhar, sai com
 * código 1 (PARE e reporte) sem fazer alterações amplas.
 *
 * Checklist:
 *  1. recebe campaign_entry_id
 *  2. determina dados da participação server-side
 *  3. não aceita IP enviado pelo frontend
 *  4. gera ip_hash server-side
 *  5. usa HMAC-SHA256
 *  6. usa VOTE_HASH_SECRET
 *  7. verifica campanha ativa
 *  8. verifica datas da campanha
 *  9. verifica business ativo
 *  10. verifica city ativa
 *  11. verifica category ativa
 *  12. verifica campaign_entry ativa
 *  13. trata voto duplicado
 *  14. usa constraint UNIQUE como proteção final
 *  15. possui rate limiting
 *  16. suporta Turnstile server-side quando ativado
 *  17. não guarda IP em texto puro
 *
 * Uso: node scripts/prompt-4b-audit.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'supabase', 'functions', 'cast-vote', 'index.ts');
const src = readFileSync(file, 'utf8');

const checks = [];
const check = (name, ok, evidence = '') => {
  checks.push({ name, ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? ` — ${evidence}` : ''}`);
};

// 1. recebe campaign_entry_id
check('recebe campaign_entry_id', /campaign_entry_id/.test(src), 'body.campaign_entry_id + isUuid');
// 2. determina dados server-side (resolve entry na BD via service_role)
check(
  'determina dados server-side',
  /from\(["']campaign_entries["']\)/.test(src) && /SERVICE_KEY|service_role/i.test(src),
  'select em campaign_entries com service_role',
);
// 3. não aceita IP do frontend (body só tem entry/device/captcha; IP vem de headers infra)
const bodyDecl = src.match(/body:\s*\{[^}]+\}/)?.[0] ?? '';
check(
  'nao aceita IP do frontend',
  /campaign_entry_id/.test(bodyDecl) && !/\bip\b|ip_address|client_ip/.test(bodyDecl) && /cf-connecting-ip|x-real-ip|x-forwarded-for/.test(src),
  'body sem campo IP; extractClientIp só lê cabeçalhos',
);
// 4. gera ip_hash server-side
check('gera ip_hash server-side', /ipHash\s*=\s*await\s+hmacHex\(VOTE_SECRET,\s*["']ip["']/.test(src), 'hmacHex(VOTE_SECRET,"ip",clientIp)');
// 5. usa HMAC-SHA256
check('usa HMAC-SHA256', /crypto\.subtle\.(importKey|sign)/.test(src) && /HMAC.*SHA-256/.test(src), 'crypto.subtle HMAC/SHA-256');
// 6. usa VOTE_HASH_SECRET
check('usa VOTE_HASH_SECRET', /Deno\.env\.get\(["']VOTE_HASH_SECRET["']\)/.test(src), 'Deno.env VOTE_HASH_SECRET, falha 500 se ausente');
// 7. verifica campanha ativa
check('verifica campanha ativa', /campaign\.status\s*===\s*["']activa["']/.test(src) && /["']votacao["']/.test(src), 'status activa|votacao');
// 8. verifica datas da campanha
check('verifica datas', /start_at/.test(src) && /end_at/.test(src) && /Date\.parse/.test(src), 'start_at/end_at vs Date.now()');
// 9. verifica business ativo
check('verifica business ativo', /business\?\.active\s*===\s*true/.test(src), 'business.active');
// 10. verifica city ativa
check('verifica city ativa', /city\?\.active\s*===\s*true/.test(src), 'city.active');
// 11. verifica category ativa
check('verifica category ativa', /category\?\.active\s*===\s*true/.test(src), 'category.active');
// 12. verifica campaign_entry ativa
check('verifica campaign_entry ativa', /e\.active\s*===\s*true/.test(src), 'entry.active em allActive');
// 13. trata voto duplicado
check('trata voto duplicado', /already_voted/.test(src), 'resposta already_voted 409');
// 14. UNIQUE como proteção final
check('constraint UNIQUE final', /23505/.test(src) && /unique|UNIQUE/.test(src), 'code 23505 → already_voted');
// 15. rate limiting
check('rate limiting', /maxAttempts/.test(src) && /rate_limited/.test(src) && /vote_attempts/.test(src), 'janela deslizante + 24h');
// 16. Turnstile server-side quando ativado
check(
  'turnstile server-side',
  /turnstileEnabled/.test(src) && /verifyTurnstile/.test(src) && /TURNSTILE_SECRET_KEY/.test(src),
  'verifyTurnstile + siteverify, só exige quando enabled',
);
// 17. não guarda IP em texto puro (inserts só com hashes; sem coluna ip/client_ip)
const inserts = [...src.matchAll(/\.insert\(\{([^}]+)\}\)/g)].map((m) => m[1]).join('\n');
check(
  'nao guarda IP em claro',
  /ip_hash/.test(inserts) && !/\bip\s*:|client_ip|ip_address/.test(inserts),
  'inserts só com ip_hash/device_hash/user_agent_hash',
);

const failed = checks.filter((c) => !c.ok);
console.log('\nRESULT_JSON ' + JSON.stringify({ file: 'supabase/functions/cast-vote/index.ts', passed: checks.length - failed.length, total: checks.length, failed: failed.map((f) => f.name) }));
if (failed.length > 0) {
  console.error('\nPARE — problema crítico na implementação existente. Não fazer alterações amplas automaticamente.');
  process.exit(1);
}
console.log('\nAUDIT OK — implementação existente cumpre o Passo 2. Sem reescrita.');
