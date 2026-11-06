# Inspeção adicional de integridade — 2026-11-06

Fonte: API Supabase `list_tables` com `verbose=true`, leitura do projeto de produção. **Sem escrita.**

## Resultados

As sete tabelas em análise apresentam **RLS ativado**. A API confirmou as chaves primárias e as relações FK abaixo, sem indicar ausência de colunas:

| Tabela | PK | FKs de saída |
|---|---|---|
| participant_invitations | id | campaign_id, city_id, category_id, business_id, campaign_entry_id, created_by, updated_by |
| category_areas | id | award_program_id |
| distinction_package_adoptions | id | award_distinction_id |
| magazine_editions | id | award_program_id, campaign_id, city_id |
| magazine_features | id | magazine_edition_id, award_distinction_id, package_adoption_id |
| magazine_images | id | magazine_feature_id |
| award_modality_categories | (modality_id, category_id) | modality_id, category_id |

A API devolveu também defaults e checks: `participant_invitations.status` default `potential` e enum controlado; `distinction_package_adoptions.status` default `active` e enum `pending|active|cancelled`; `magazine_editions.status` default `draft`; `magazine_features.is_published` default `false`. A tabela N:N `award_modality_categories` tem PK composta e `created_at` default `now()`.

**Importante:** `rls_enabled=true` não prova que as policies estejam corretas. A API de listagem não inclui triggers, índices não-PK, definições integrais de constraints, policies ou corpos de funções. Não declarar migrations reconciliadas integralmente.

## Próximos passos

Comparar policies e triggers com SQL do GitHub e inspecionar a origem da tabela N:N; usar consultas de leitura ou exportação de metadados se necessário. Não aplicar migrations, não alterar histórico remoto e não executar `db push` antes de testes e autorização explícita.
