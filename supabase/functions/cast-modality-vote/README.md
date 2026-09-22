# cast-modality-vote — FASE 5C.3.9 (LOCAL, SEM DEPLOY)

Edge Function SEPARADA de `cast-vote` (que permanece intocável) para a
votação independente por modalidade.

- Contrato: `POST { campaign_entry_id: uuid, modality_id: uuid,
  device_id?: string, captcha_token?: string }`
- Resolve campanha/cidade/categoria/empresa server-side a partir da entry;
  valida programa × categoria × modalidade × cidade × participação.
- Escreve EXCLUSIVAMENTE em `modality_votes` + `modality_vote_attempts`
  (nunca `votes` / `vote_attempts` / `vote_adjustments`, nunca
  `award_distinctions`).
- 1 pessoa = 1 voto POR MODALIDADE
  (`UNIQUE campaign, city, category, modality, ip_hash`).

## Deploy (APENAS após revisão humana — NÃO executar nesta fase)

```bash
supabase functions deploy cast-modality-vote --no-verify-jwt
supabase secrets set VOTE_HASH_SECRET=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
# Se Turnstile activo: TURNSTILE_SECRET_KEY=...
```

`verify_jwt = false` (voto público anónimo, como `cast-vote`).
Ver `supabase/config.toml` (`[functions.cast-modality-vote]`).
