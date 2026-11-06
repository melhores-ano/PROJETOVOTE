# Verificação de colunas com CSV do Supabase — 2026-11-06

Fonte: CSV exportado pelo utilizador da consulta `information_schema.columns` (94 linhas; 7 tabelas). Comparação estática com ficheiros da branch `main` do GitHub. **Sem operações de escrita em produção.**

| Migration | Tabela | Colunas CSV | Comparação |
|---|---|---:|---|
| 0018 | participant_invitations | 19 | nomes e tipos coincidentes |
| 0019 | category_areas | 10 | nomes e tipos coincidentes |
| 0020 | distinction_package_adoptions | 20 | nomes e tipos coincidentes |
| 0021 | magazine_editions | 14 | nomes e tipos coincidentes |
| 0021 | magazine_features | 22 | nomes e tipos coincidentes |
| 0021 | magazine_images | 6 | nomes e tipos coincidentes |
| a identificar | award_modality_categories | 3 | ainda não comparada com definição CREATE TABLE |

**Resultado:** 91 de 94 colunas confirmadas por nome e tipo, distribuídas por seis tabelas. Os tipos `timestamp with time zone` do CSV correspondem a `timestamptz` no SQL.

**Limites:** o CSV não inclui defaults, constraints, índices, triggers, RLS, grants ou definições de funções. A coincidência de colunas **não prova** equivalência integral nem justifica marcar migrations como executadas.

**Próximas verificações:** origem de `award_modality_categories`; `pg_constraint`, `pg_indexes`, `pg_policies`, `pg_trigger`, `pg_get_functiondef` em consultas exclusivamente de leitura. Não executar migrations 0018–0024, não corrigir o histórico remoto e não usar `db push` sem aprovação explícita e testes.
