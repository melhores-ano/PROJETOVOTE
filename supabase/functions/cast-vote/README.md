# Edge Function `cast-vote` — motor de votação (Phase 2)

## Deploy

```bash
supabase functions deploy cast-vote --no-verify-jwt
supabase secrets set VOTE_HASH_SECRET="<64+ hex aleatórios>"
# Opcional (só se Turnstile activo):
supabase secrets set TURNSTILE_SECRET_KEY="<turnstile-secret>"
```

> `cast-vote` é pública por desenho (visitantes anónimos votam) — daí
> `--no-verify-jwt`. A segurança vem da validação server-side + HMAC +
> UNIQUE constraint + rate-limit, não do JWT.

## Contrato

`POST /functions/v1/cast-vote`
`{ "campaign_entry_id": "<uuid>", "device_id": "<anon-id>", "captcha_token": "<turnstile>" }`

Respostas: `success | already_voted | campaign_closed | invalid_entry |
rate_limited | captcha_failed | server_error` (sempre PT, sem leaks internos).

## Configuração (site_settings, sem segredos)

| key | defeito | efeito |
|---|---|---|
| `voting_enabled` | true | false => `campaign_closed` |
| `turnstile_enabled` | false | true => exige `captcha_token` válido |
| `turnstile_site_key` | "" | site key pública (frontend) |
| `vote_rate_window_seconds` | 600 | janela do rate-limit |
| `vote_rate_max_attempts` | 20 | tentativas/janela/ip_hash |
| `vote_rate_max_votes_24h` | 30 | votos/24h/ip_hash |

Segredos (Edge Secrets, nunca no frontend): `VOTE_HASH_SECRET`,
`TURNSTILE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (gerido pela plataforma).
