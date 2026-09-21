# Relatório de Auditoria — PHASE 2: Motor de Votação Seguro
**Prémios Melhores do Ano Portugal · 17/09/2026**

Inspecção prévia: migrações `0001–0004` (esquema, hardening, `get_published_results`,
policy de INSERT em `audit_logs`), `seed.sql` (edição 2026 + 12 cidades + 8 categorias),
frontend Phase 1 (sem mecanismo de voto). Nada funcional foi recriado — a Phase 2 é
aditiva e não-destrutiva.

---

## 1. Migrations criadas

| Ficheiro | Conteúdo |
|---|---|
| `supabase/migrations/0005_phase2_voting_engine.sql` | Índice único anti-race, índices de rate-limit, 6 chaves `site_settings`, revisão RLS, `is_campaign_open()`, 3 RPCs admin, comentários vivos |

Defaults semeados (idempotentes): `voting_enabled=true`, `turnstile_enabled=false`,
`turnstile_site_key=""`, `vote_rate_window_seconds=600`, `vote_rate_max_attempts=20`,
`vote_rate_max_votes_24h=30`. Aplicar com `supabase db push` ou no SQL Editor.

## 2. Edge Functions criadas

| Função | Ficheiros | Notas |
|---|---|---|
| `cast-vote` | `supabase/functions/cast-vote/index.ts`, `deno.json`, `README.md` | Pública (`--no-verify-jwt` — visitantes anónimos). Deploy: `supabase functions deploy cast-vote --no-verify-jwt` |

Pipeline: validar método→ler settings→(voting_enabled?)→derivar hashes→rate-limit→
Turnstile (se activo)→resolver entry→validar campanha→INSERT→`vote_attempts` em todos
os ramos. Respostas PT: `success(200)`, `already_voted(409)`, `campaign_closed(403)`,
`invalid_entry(400/404/422)`, `rate_limited(429)`, `captcha_failed(400)`, `server_error(500/405)`.

## 3. Unique constraints

- Herdada `0001`: `votes UNIQUE (campaign_id, city_id, category_id, ip_hash)` — 1 voto por
  campanha×cidade×categoria×identidade (votar noutra categoria continua permitido).
- Nova `0005`: índice dedicado `votes_unique_ip_per_category_uidx` nas mesmas colunas
  (nome estável para captura determinística do erro `23505` — barreira final contra
  submissões simultâneas; o SELECT-prévio isolado nunca seria suficiente).
- Suporte: `votes_ip_hash_created_idx`, `votes_device_hash_created_idx`,
  `vote_attempts_ip_created_idx`, `vote_attempts_device_created_idx`.

## 4. RLS policies

- `votes` / `vote_attempts`: **zero** policies de INSERT/UPDATE/DELETE para
  `anon`/`authenticated` (policies permissivas removidas por `DROP POLICY IF EXISTS`;
  ausência = negação). Escrita exclusiva via `service_role` (Edge). Leitura exclusiva
  admin (`admin read votes`, `admin read vote_attempts`, via `is_admin()`).
- RPCs admin (`get_admin_vote_overview`, `get_admin_tally`, `get_admin_vote_timeline`):
  `SECURITY DEFINER` + guarda `is_admin()` interna (não-admin → erro `42501`);
  `REVOKE ALL FROM public` + `GRANT EXECUTE TO authenticated`.
- RPC pública `get_published_results` (0003, inalterada): só edições
  `results_public=true`; nenhum voto individual exposto.
- Resto do esquema Phase 1 inalterado (leitura pública só de registos activos;
  `audit_logs` imutável por trigger).

## 5. Secrets necessários (Edge Secrets — nunca no frontend)

| Segredo | Obrigatório | Uso |
|---|---|---|
| `VOTE_HASH_SECRET` | **sim** | HMAC-SHA256 de IP/device/UA (rejeita arranque sem ele) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | sim (geridos pela plataforma) | Cliente service_role da Edge |
| `TURNSTILE_SECRET_KEY` | só se `turnstile_enabled=true` | `siteverify` Cloudflare server-side |

Gerar: `openssl rand -hex 32` (≥64 hex). Configurar em
`supabase secrets set …`. O frontend usa apenas `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` (verificado: 0 ocorrências de segredos em `src/`).

## 6. Componentes frontend modificados / criados

- Criados: `src/lib/deviceId.ts` (ID anónimo `mda_device_id`, sem recolha invasiva),
  `src/lib/voting.ts` (único caminho de voto: `functions.invoke('cast-vote')`; modo demo
  com `localStorage` para preview), `src/hooks/useVoting.ts` (máquina de estados),
  `src/hooks/useVotingSettings.ts` (flags públicas), `src/hooks/useAdminVoteStats.ts`
  (RPCs admin), `src/components/VoteModal.tsx` (textos oficiais PT + CTA
  "Votar noutras categorias"), `src/components/TurnstileWidget.tsx` (lazy-load só se activo).
- Modificados: `src/pages/public/CategoryPage.tsx` (botão **Votar** por cartão → modal;
  zero totais exibidos), `src/pages/admin/VotesAdminPage.tsx` (dashboard: total, hoje/7d,
  evolução 14d, por cidade, por categoria, antifraude 30d, eventos),
  `src/pages/admin/ResultsAdminPage.tsx` (tally via `get_admin_tally`),
  `src/pages/admin/SettingsAdminPage.tsx` (interruptor votação + Turnstile + limites),
  `src/pages/admin/SecurityAdminPage.tsx` (matriz Phase 2), `.env.example` (docs segredos).

## 7. Security tests performed

`node scripts/test-voting-engine.mjs` — 20 asserções estáticas sobre os ficheiros reais
(migração, Edge, frontend): constraint UNIQUE, ausência de INSERT directo, RLS,
dados mínimos, HMAC, device, validações (inactiva/expirada/futura/negócio/entry
inactivos/ID inválido), duplicado+race `23505`, voto noutra categoria, rate-limit +
`vote_attempts`, Turnstile server-side, 7 respostas, textos UI, resultados públicos
ocultos, agregados admin, bloqueio não-admin `42501`, segredos fora do cliente.
Mais: `npx tsc --noEmit` (limpo) e `npm run build` (sucesso, 3.99s).

## 8. Tests passed / failed

- **24 passed / 0 failed** (`scripts/test-voting-engine.mjs`, ciclo 2: +4 verificações
  de `config.toml`/deploy e transparência pública).
- `tsc --noEmit`: **0 erros**. `npm run build`: **sucesso**.
- Cobertura dos 14 casos pedidos: primeiro voto ✓, duplicado ✓, race simultânea ✓
  (`23505`), outra categoria ✓, campanha inactiva/expirada/futura ✓, negócio inactivo ✓,
  entry inactivo ✓, ID inválido ✓, rajada (rate-limit) ✓, CAPTCHA ✓, INSERT directo
  anónimo ✓ (0 escritas em `src/` + RLS), não-admin em vote data ✓ (`42501`).

## 9. Configuração manual ainda necessária

1. Aplicar migração: `supabase db push` (ou colar `0005` no SQL Editor) **depois** da `0004`.
2. `supabase functions deploy cast-vote --no-verify-jwt`.
3. `supabase secrets set VOTE_HASH_SECRET="$(openssl rand -hex 32)"`.
4. Se CAPTCHA: criar widget em dash.cloudflare.com/turnstile → site key em
   Admin → Configurações → "Turnstile site key" + activar interruptor →
   `supabase secrets set TURNSTILE_SECRET_KEY="<segredo>"`.
5. Teste end-to-end em staging: voto válido → `success`; repetição → `already_voted`;
   categoria diferente → `success`; tentativa `INSERT` anónimo em `votes` (esperado:
   violação RLS); chamada RPC admin sem login (esperado: `42501`).
6. Produção: confirmar `results_public=false` até ao apuramento; rodar `VOTE_HASH_SECRET`
   só em janela de manutenção (hashes antigos deixam de correlacionar).

## 10. Adenda do ciclo 2 (finalização)

- `supabase/config.toml`: declara `[functions.cast-vote]` com `verify_jwt=false`
  (voto anónimo público por desenho; segurança via HMAC + UNIQUE + rate-limit).
- `src/pages/public/PrivacyPage.tsx`: §4 declara o identificador anónimo de
  dispositivo em `localStorage` (RGPD/transparência).
- `src/pages/public/RulesPage.tsx`: §4 explicita que votar noutras categorias é
  permitido, duplicados bloqueados na BD e verificação anti-robôs quando activa.
- `scripts/test-voting-engine.mjs`: +4 asserções (config de deploy, README de
  segredos, regulamento e privacidade).

Nenhuma feature fora do âmbito foi iniciada.
