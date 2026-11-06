# Auditoria remota da migration 0022 — revista pública (2026-11-06)

**Ambiente:** Supabase `agtgtcnwfrskvpegxoir`. **Somente leitura; nenhuma migração executada.**

## Definições SQL

Foram consultadas as definições completas das três funções com `pg_get_functiondef` e confrontadas visualmente com `supabase/migrations/0022_phase642_magazine_public_read.sql`:

| RPC | Assinatura | Campos e regras observados |
|---|---|---|
| `get_published_magazine` | `(text,text)` | 14 campos públicos; programa ativo; edição `published` com `published_at`; slugs não vazios; `LIMIT 1` |
| `get_published_magazine_features` | `(text,text)` | 24 campos; edição publicada; matéria publicada; distinção não cancelada; adesão `active` e `includes_publication=true`; galeria JSON ordenada |
| `get_published_magazine_feature_images` | `(text,text,text)` | 3 campos; mesmas condições de elegibilidade; imagens ordenadas por `sort_order` e `created_at` |

Os corpos SQL observados correspondem visualmente ao SQL local (incluindo joins, predicados, projeções e ordenação). Diferenças de serialização de `pg_get_functiondef` não são consideradas divergências semânticas. **Não foi efetuada comparação automatizada de AST nem teste funcional de acessos anon.**

Todas as três funções são `STABLE SECURITY DEFINER`, `search_path=public` e permitem `EXECUTE` a `anon` e `authenticated`, como previsto no ficheiro.

## Isolamento das tabelas

Consulta a `pg_policies` identificou **uma policy administrativa** em cada tabela:
- `magazine_editions`: `admin manage magazine_editions`, ALL, authenticated.
- `magazine_features`: `admin manage magazine_features`, ALL, authenticated.
- `magazine_images`: `admin manage magazine_images`, ALL, authenticated.

Nenhuma policy pública adicional foi identificada. `pg_class.relrowsecurity=true` nas três tabelas; `relforcerowsecurity=false`.

**Nuance importante:** `has_table_privilege('anon', ..., 'SELECT')` e `has_table_privilege('authenticated', ..., 'SELECT')` devolvem **true** nas três tabelas. Isto indica grants SQL de SELECT, **não** leitura efetiva de linhas: RLS permanece ativo e as policies listadas restringem o acesso. Portanto, evitar afirmar que não existem grants de leitura; o modelo atual depende da combinação grants + RLS. É recomendável validar acesso real com papéis anon/authenticated num ambiente isolado.

## Estado de reconciliação

- A lógica observada nas três RPCs corresponde visualmente à migration `0022`.
- RLS ativo e policies administrativas presentes; ausência de policy pública observada.
- **Ainda não se pode marcar 0022 como aplicada no histórico**: a migração também inclui operações de RLS/policies e validações, e o histórico remoto continua até `0017`.
- Não executar `db push`, `migration repair`, revogações ou alterações à produção antes de backup, comparação integral e aprovação explícita.
