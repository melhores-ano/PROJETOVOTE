# PROMPT 4B — Backend / Edge Function (registo operativo, backend-only)

> Este ficheiro é apenas registo operativo do Prompt 4B. Não altera frontend,
> componentes React, páginas, migrations 0001–0008, tabelas, RLS, nem adiciona
> funcionalidades. A Edge Function `cast-vote` NÃO foi reescrita.

- Projeto: `melhores-do-ano-portugal`
- Ref: `agtgtcnwfrskvpegxoir`
- URL: `https://agtgtcnwfrskvpegxoir.supabase.co`
- Função: `supabase/functions/cast-vote/index.ts` (verificação `verify_jwt = false` em `supabase/config.toml` — votação pública por desenho)
- Script read-only: `scripts/prompt-4b-check.mjs`
- Helper de deploy (PASSO 5): `scripts/prompt-4b-deploy.mjs`
- Bateria segura de testes (PASSO 7, gated): `scripts/prompt-4b-vote-tests.mjs`
- Auditoria estática (PASSO 2): `scripts/prompt-4b-audit.mjs` (17/17 PASS em 2026-09-17)
- Helper de segredos (PASSO 3, seguro): `scripts/prompt-4b-secrets.mjs` (--status/--generate)

## Como re-verificar (somente leitura)

```powershell
npm run backend:4b:check
npm run backend:4b:audit
npm run backend:4b:secrets
node scripts/verify-real-backend.mjs
```

## Deploy / segredos (requer acesso owner — manual)

```bash
supabase login
supabase secrets set VOTE_HASH_SECRET="<64+ hex aleatórios>" --project-ref agtgtcnwfrskvpegxoir
supabase functions deploy cast-vote --project-ref agtgtcnwfrskvpegxoir --no-verify-jwt
```

Nunca colocar `VOTE_HASH_SECRET` em código, frontend, `VITE_*`, `site_settings` ou Git.
`TURNSTILE_SECRET_KEY` só é necessário quando `turnstile_enabled=true` (nesta fase: `false`).

## Último estado live medido (2026-09-17, ciclo 20)

`npm run backend:4b:check` + `npm run backend:4b:audit` + `prompt-4b-secrets --status`:
- PASSO 1: 8/8 tabelas ACCESSIBLE (HTTP 200)
- PASSO 2: auditoria estática 17/17 PASS, sem reescrita
- PASSO 4: `turnstile_enabled=false` (HTTP 200)
- PASSO 5/6: CODE EXISTS=true, DEPLOYED=false (HTTP 404 NOT_FOUND), REACHABLE=false
- PASSO 3: `VOTE_HASH_SECRET` → MANUAL ACTION REQUIRED (CLI sem `SUPABASE_ACCESS_TOKEN`)
- PASSO 7: NOT TESTED (gated — exige função deployed + secret; `prompt-4b-vote-tests` pronto com `--cleanup`)

Relatório final padronizado (ciclo 20): CONNECTION ✅ / CODE ✅ / SECRET ⚠️ / TURNSTILE ✅ /
DEPLOYED ❌ / REACHABLE ❌ / 6 testes ⏭️. Deploy + secret + testes live exigem ação owner
(`supabase login`, secrets set, functions deploy). PARE — sem frontend.
