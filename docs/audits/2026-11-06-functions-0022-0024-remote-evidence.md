# Verificação somente leitura — funções das migrations 0022–0024 (2026-11-06)

**Ambiente:** projeto Supabase `agtgtcnwfrskvpegxoir`. **Nenhum SQL de escrita executado.**

## Evidência obtida

Consulta ao catálogo `pg_proc` com `pg_get_function_identity_arguments`, `pg_get_functiondef`, `prosecdef`, `provolatile`, `proconfig` e `has_function_privilege`. Hash MD5 é apenas identificador da definição remota, **não** comprova equivalência ao ficheiro GitHub.

| Função | Assinatura | SECURITY DEFINER | Volatilidade | search_path | EXECUTE anon/authenticated | MD5 definição remota |
|---|---|---|---|---|---|---|
| get_published_magazine | (text,text) | sim | STABLE | public | sim/sim | 58f4092c71781229dc64a9e878322858 |
| get_published_magazine_features | (text,text) | sim | STABLE | public | sim/sim | 51a2633502155f420d288f0c5b963393 |
| get_published_magazine_feature_images | (text,text,text) | sim | STABLE | public | sim/sim | a017905b63be4874bd8a3cfd4c7e9683 |
| modality_votes_validate | () RETURNS trigger | sim | VOLATILE | public | sim/sim | bdc8bc2d8676c2aed2669f2825d4d8ba |
| award_distinctions_validate | () RETURNS trigger | sim | VOLATILE | public | sim/sim | f8a40e093f7283d5539b1bd29e889490 |

As funções públicas de matérias e imagens contêm referência a `includes_publication`; as duas funções de validação contêm referência a `award_modality_categories`. Isto **não comprova** que todos os predicados de segurança e regras do SQL local sejam iguais aos remotos.

## Observação de segurança

As duas funções `RETURNS trigger` também têm privilégio `EXECUTE` para `anon` e `authenticated`, conforme o catálogo. A execução direta de funções de trigger geralmente falha fora de um contexto de trigger, pelo que **não classificar automaticamente como exploração**. Rever a necessidade destes grants e os restantes privilégios num plano de correção isolado; não revogar em produção sem análise de dependências.

## Decisão

- **0022:** assinaturas, modo de execução, `search_path` e grants compatíveis com o ficheiro; equivalência integral **pendente**.
- **0023 e 0024:** funções presentes e referência N:N confirmada; equivalência integral **pendente**.
- Histórico remoto permanece `0001`–`0017`; não marcar `0018`–`0024` como aplicadas sem comparação completa.
- Próxima etapa: obter definições remotas completas, normalizar e comparar corpos, argumentos, retornos, triggers e políticas; validar em ambiente isolado antes de qualquer proposta de reparação.

**Proibido nesta fase:** `db push`, `migration repair`, DDL, grants/revokes e alterações de dados na produção.
