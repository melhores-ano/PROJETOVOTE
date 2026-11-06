# Reconciliação de triggers multicategoria — 0023/0024 (2026-11-06)

**Consulta de produção somente leitura.** Nenhuma alteração de dados, DDL ou permissões.

## Comparação de definições

Foram obtidas as definições completas remotas via `pg_get_functiondef` e comparadas visualmente com:
- `supabase/migrations/0023_phase66_multicategory_modality_validation.sql`
- `supabase/migrations/0024_phase66_multicategory_distinction_validation.sql`

Os corpos PL/pgSQL remotos observados correspondem aos corpos nos ficheiros locais, incluindo verificações de campanha, programa, categoria N:N (`award_modality_categories`), país, cidade e negócio; a validação de votos de modalidade inclui ainda participação ativa, preenchimento de `campaign_entry_id` e modalidade ativa. As diferenças visíveis são de formatação emitida pelo PostgreSQL (`CREATE OR REPLACE FUNCTION`, `SET search_path TO 'public'`, delimitador `$function$` e CRLF). **Esta é uma comparação visual, não um teste automatizado de equivalência byte a byte.**

## Triggers associados confirmados remotamente

| Tabela | Trigger | Momento e eventos |
|---|---|---|
| `public.award_distinctions` | `trg_award_distinctions_validate` | BEFORE INSERT OR UPDATE OF campaign_id, city_id, category_id, modality_id, business_id |
| `public.modality_votes` | `trg_modality_votes_validate` | BEFORE INSERT OR UPDATE OF campaign_id, city_id, category_id, modality_id, business_id |

Ambos são `FOR EACH ROW` e invocam a respetiva função. O catálogo confirma `SECURITY DEFINER` e `search_path=public`.

## Estado

- **0023:** lógica principal da função e trigger associados presentes; correspondência visual observada. Histórico de migration não reconciliado.
- **0024:** lógica principal da função e trigger associados presentes; correspondência visual observada. Histórico de migration não reconciliado.
- Não confundir correspondência da função com equivalência completa do estado do banco, dos grants ou de todos os objetos relacionados.
- **Não** executar `migration repair`, `db push` ou DDL em produção.

## Próxima verificação

Comparar integralmente as três RPCs de revista da migration 0022, incluindo predicados de elegibilidade, lista de campos retornados, ordenação, grants e dependências. 
