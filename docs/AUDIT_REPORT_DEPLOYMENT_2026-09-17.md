# Relatório de Auditoria — Deployment & Implementação (17/09/2026)

**Prémios Melhores do Ano Portugal — Phases 1, 2 e 3**
**Natureza: AUDITORIA. Nenhuma feature implementada, nenhuma migration modificada, nenhuma tabela criada.**

## Método

- Inspeção direta dos ficheiros do projeto (`supabase/migrations/`, `supabase/functions/cast-vote/`,
  `src/`, `.env`, `.env.local`, `docs/AUDIT_REPORT_PHASE2.md`).
- Teste estático `node scripts/test-voting-engine.mjs` → **24 passed, 0 failed**.
- Nenhum ficheiro de código foi criado ou modificado nesta auditoria.

## Facto central

O backend ligado neste workspace **não é um Supabase real**. `.env` / `.env.local` contêm apenas
placeholders `codein-local-preview` / `codein-local.supabase.co`, e `src/lib/supabase.ts:35-41`
deteta-os e nunca tenta rede — a app corre em modo fallback/demo local (`localStorage`).
Por isso, todo o estado "real do backend" abaixo é **CANNOT VERIFY**, com evidência.

---

## A. DATABASE — tabelas

Todas as 12 tabelas estão definidas em código
(`supabase/migrations/0001_phase1_schema.sql:26-249`, `CREATE TABLE IF NOT EXISTS`).
Existência real no backend: **CANNOT VERIFY** (sem ligação a Supabase real).

| Tabela | Código | Existe no backend |
|---|---|---|
| campaigns | ✅ 0001:26 | ⚠️ CANNOT VERIFY |
| cities | ✅ 0001:49 | ⚠️ CANNOT VERIFY |
| categories | ✅ 0001:70 | ⚠️ CANNOT VERIFY |
| businesses | ✅ 0001:88 | ⚠️ CANNOT VERIFY |
| business_categories | ✅ 0001:118 | ⚠️ CANNOT VERIFY |
| campaign_entries | ✅ 0001:130 | ⚠️ CANNOT VERIFY |
| votes | ✅ 0001:156 | ⚠️ CANNOT VERIFY |
| vote_attempts | ✅ 0001:177 | ⚠️ CANNOT VERIFY |
| profiles | ✅ 0001:196 | ⚠️ CANNOT VERIFY |
| site_settings | ✅ 0001:212 | ⚠️ CANNOT VERIFY |
| audit_logs | ✅ 0001:222 | ⚠️ CANNOT VERIFY |
| sponsors | ✅ 0001:237 | ⚠️ CANNOT VERIFY |

## B. MIGRATIONS

| Ficheiro | Propósito | Aplicada? |
|---|---|---|
| `0001_phase1_schema.sql` | Esquema base: 12 tabelas + RLS + storage buckets | ⚠️ CANNOT VERIFY |
| `0002_phase1_hardening.sql` | `audit_logs` imutável (trigger anti UPDATE/DELETE) + `updated_at` em `site_settings` | ⚠️ CANNOT VERIFY |
| `0003_published_results.sql` | RPC pública `get_published_results()` (só `results_public=true`) | ⚠️ CANNOT VERIFY |
| `0004_audit_insert_policy.sql` | Policy `admin insert audit` + `search_path` fixo em `is_admin`/`is_super_admin` | ⚠️ CANNOT VERIFY |
| `0005_phase2_voting_engine.sql` | **Voting engine:** índice único dedicado `votes_unique_ip_per_category_uidx`, índices rate-limit, 6 chaves `site_settings`, re-endurecimento RLS votes/vote_attempts, `is_campaign_open()`, 3 RPCs admin | ⚠️ CANNOT VERIFY |
| `0006_phase3_admin_governance.sql` | Bloqueio de DELETE de campanhas/entries com votos + índices operacionais admin | ⚠️ CANNOT VERIFY |

Nota: `docs/AUDIT_REPORT_PHASE2.md:105-107` lista `supabase db push` como passo manual ainda
necessário — confirma que a aplicação nunca foi verificada. Sem CLI/backend ligado, não há
tracking de migrations acessível.

## C. VOTING SECURITY (código vs. BD real)

Verificado em código; estado aplicado real: **CANNOT VERIFY**.

- Anónimo sem INSERT em `votes`: ✅ código (0001:331-334 + 0005 remove policies permissivas; ausência = negação).
- Anónimo sem UPDATE/DELETE em `votes`: ✅ código (idem).
- Constraint única anti-duplicado: ✅ código (0001:168 + índice dedicado 0005:33-34).
- Limite por campaign+city+category+ip_hash: ✅ código (colunas exatas da constraint).
- Sem IP em claro: ✅ código (só `ip_hash/device_hash/user_agent_hash`; Edge deriva HMAC-SHA256 server-side, `cast-vote/index.ts:179-181`).

## D. EDGE FUNCTION `cast-vote`

- CODE EXISTS: **YES** — `supabase/functions/cast-vote/index.ts` (334 linhas) + `deno.json` + `README.md`; `config.toml` com `verify_jwt=false`.
- DEPLOYED TO CONNECTED SUPABASE: **CANNOT VERIFY** (sem dashboard/CLI; doc Phase 2 lista o deploy como passo manual pendente).
- FUNCTION REACHABLE: **CANNOT VERIFY** (`src/lib/voting.ts:64` só invoca com backend real configurado, que é `false` aqui).

## E. SECRETS

| Segredo | REQUIRED | CONFIGURED |
|---|---|---|
| `VOTE_HASH_SECRET` | YES (Edge recusa arranque sem ele, `index.ts:115-118`) | CANNOT VERIFY |
| `TURNSTILE_SECRET_KEY` | Condicional (só se `turnstile_enabled=true`; default `false`) | CANNOT VERIFY |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | YES (plataforma, na Edge) | CANNOT VERIFY |

Zero ocorrências de segredos em `src/` (asserção 20 do teste estático). Nenhum valor revelado.

## F. RLS (configuração em código)

- `votes`, `vote_attempts`: ✅ sem policies para `anon`; só `SELECT` para `authenticated` com `is_admin()`.
- `profiles`: ✅ leitura própria; gestão só `super_admin`.
- `audit_logs`: ✅ leitura + INSERT só admin; UPDATE/DELETE bloqueados por trigger (inclusive `service_role`).
- `site_settings`: ⚠️ **atenção** — `public read settings` permite `SELECT` a `anon` com `using (true)` (0001:323-325). Sem segredos lá por desenho, mas chaves futuras sensíveis ficariam expostas.
- Estado aplicado real de todas: ⚠️ CANNOT VERIFY.

## G. ADMIN — rotas

Todas existem e estão ligadas em `src/App.tsx:114-131`; componentes em `src/pages/admin/` usam
hooks reais (`useAdminData`, `useAdminVoteStats`, `useDirectory`) com fallback `SupabaseNotice`.
Nenhuma é placeholder vazio (verificadas em detalhe: Votes + Security; restantes seguem o padrão).

| Rota | Estado em código |
|---|---|
| `/admin/login`, `/admin`, `/admin/campanhas`, `/admin/cidades`, `/admin/categorias`, `/admin/empresas`, `/admin/participantes`, `/admin/votos`, `/admin/resultados`, `/admin/seguranca`, `/admin/configuracoes` | ✅ funcional em código; live ⚠️ not verified |

Extras: `/admin/importar`, `/admin/auditoria`, `/admin/patrocinadores`, `/admin/utilizadores` (só `super_admin`).

## H. REAL VOTING TEST

**Não executado — deliberadamente.** Sem backend real ligado, qualquer "teste" correria contra o
mock `localStorage`, sem valor probatório; e sem ambiente seguro não se toca em produção.
Substituto: teste estático 24/24 (cobre os 14 casos lógicos: primeiro voto, duplicado, race
`23505`, outra categoria, campanha inativa/expirada/futura, negócio/entry inativos, ID inválido,
rate-limit, CAPTCHA, INSERT direto, `42501`). Teste live (6 cenários + limpeza) fica como ação
requerida em staging.

## I. "ARQUIVOS PENDENTES" (Lovable)

No Lovable, "ARQUIVOS PENDENTES" = edições da sessão ainda **não publicadas** (botão Publish) —
i.e., deployment pending da plataforma, não Git nem ficheiros por gravar. **Não verificável
deste workspace**: checkout local em disco, sem sessão Lovable, sem metadados de pendência,
sem Git no shell. Árvore local = estado final em disco, sem marcadores de pendência.
Ação: confirmar no painel Lovable se há Publish por fazer.

---

## FINAL REPORT

| ITEM | CODE EXISTS | APPLIED/DEPLOYED | VERIFIED WORKING | ACTION REQUIRED |
|---|---|---|---|---|
| Tabelas (12) | ✅ Verified | ⚠️ Not verified | ⚠️ Not verified | `db push` + Table Editor |
| Migrations 0001–0006 | ✅ Verified | ⚠️ Not verified | ⚠️ Not verified | Aplicar por ordem; verificar tracking |
| Segurança votação | ✅ Verified | ⚠️ Not verified | ⚠️ Not verified | Teste live H em staging |
| Edge `cast-vote` | ✅ Verified | ⚠️ Not verified | ⚠️ Not verified | `functions deploy` + teste alcance |
| Secrets | ✅ Verified | ⚠️ Not verified | ⚠️ Not verified | `secrets set` + dashboard |
| RLS restantes | ✅ Verified | ⚠️ Not verified | ⚠️ Not verified | Rever `site_settings` público |
| Admin (11 rotas) | ✅ Verified | n/a (frontend) | ⚠️ Not verified live | Login real + smoke test |
| Voto real end-to-end | ❌ Missing | ❌ Missing | ❌ Missing | Executar H em staging + limpar |
| "Arquivos pendentes" | n/a | ⚠️ Not verified | ⚠️ Not verified | Confirmar Publish no Lovable |

## 1. O QUE JÁ ESTÁ REALMENTE FUNCIONAL

- Código completo das Phases 1–3 em disco, consistente entre si (esquema, voting engine, governação admin).
- 24/24 asserções estáticas do motor de votação; frontend nunca escreve em `votes`.
- Site público e admin renderizam em modo demo/fallback sem crashes.
- Nada mais — não há evidência de aplicação, deploy ou segredos configurados.

## 2. O QUE AINDA PRECISA SER FEITO

1. Ligar Supabase real + `db push` (0001→0006) + `seed.sql` + `bootstrap_admin.sql`.
2. `functions deploy cast-vote --no-verify-jwt` + `secrets set VOTE_HASH_SECRET` (+ Turnstile se ativo).
3. Teste de votação real H em staging + limpeza.
4. Endurecer/documentar leitura pública total de `site_settings`.
5. Confirmar Publish no Lovable.
6. Só depois: Phase 4.
