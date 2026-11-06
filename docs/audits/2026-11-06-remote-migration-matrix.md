# Reconciliação de migrations — evidência remota (2026-11-06)

**Estado:** diagnóstico confirmado por consultas SQL somente leitura; **não** é autorização para aplicar migrations.

## Histórico remoto

A consulta a `supabase_migrations.schema_migrations` devolveu exatamente as versões `0001`–`0017`, incluindo `0014 = phase5c38_award_modalities`. Nenhuma versão `0018`–`0024` aparece no histórico remoto.

O GitHub contém 25 ficheiros SQL, com duas entradas `0014`:
- `0014_phase5c38_award_modalities.sql` — corresponde ao nome registado remotamente.
- `0014_phase65_catalog_pt_areas_categories.sql` — **colisão de versão** e não corresponde à migration remota `0014`.

Não renomear, apagar ou reaplicar estes ficheiros sem analisar o seu conteúdo, a origem da aplicação e as dependências.

## Matriz de reconciliação

| Ficheiro GitHub | Evidência remota observada | Resultado | Ação |
|---|---|---|---|
| `0018_phase61_participant_invitations.sql` | Tabela `participant_invitations` existe | Objeto presente; equivalência integral **não comprovada** | Comparar colunas, constraints, triggers, policies e funções |
| `0019_phase62_category_areas.sql` | Tabela `category_areas` existe | Objeto presente; equivalência integral **não comprovada** | Comparar `categories.area_id`, constraints, RLS e triggers |
| `0020_phase631_digital_package_adoptions.sql` | Tabela `distinction_package_adoptions` existe | Objeto presente; equivalência integral **não comprovada** | Comparar FKs, estados, validações e policies |
| `0021_phase641_magazine_foundation.sql` | `magazine_editions`, `magazine_features`, `magazine_images` existem | Objetos presentes; equivalência integral **não comprovada** | Comparar objetos e bucket `magazine-images` |
| `0022_phase642_magazine_public_read.sql` | `get_published_magazine`, `get_published_magazine_features`, `get_published_magazine_feature_images` existem | RPCs presentes; equivalência integral **não comprovada** | Comparar definições, `EXECUTE` e predicados de publicação |
| `0023_phase66_multicategory_modality_validation.sql` | `award_modality_categories` existe; `modality_votes_validate()` referencia a tabela | Relação multicategoria presente; equivalência integral **não comprovada** | Comparar definição completa da função e triggers |
| `0024_phase66_multicategory_distinction_validation.sql` | `award_distinctions_validate()` referencia `award_modality_categories` | Validação multicategoria presente; equivalência integral **não comprovada** | Comparar definição completa e regras de distinção |
| `0014_phase65_catalog_pt_areas_categories.sql` | Histórico `0014` aponta para **outro** ficheiro | **Conflito de versão confirmado** | Inspecionar efeito real e atribuir versão nova somente após reconciliação |

**Outros objetos remotos identificados:** `magazine_premium_spaces` e `magazine_premium_editorials`. A sua origem deve ser investigada; não atribuir uma migration específica sem evidência.

## Conclusões operacionais

1. **Bloquear `supabase db push` e aplicação sequencial cega de `0018`–`0024`** enquanto existir divergência.
2. A existência de tabelas/RPCs **não prova** que a migration correspondente foi executada integralmente.
3. Não inserir versões manualmente em `supabase_migrations.schema_migrations` sem confirmar que todos os efeitos SQL da versão estão presentes.
4. Não renumerar `0014_phase5c38_award_modalities.sql`: está associado ao histórico remoto.
5. Corrigir o conflito do segundo `0014` apenas numa proposta separada e depois de identificar a origem dos objetos que cria.
6. Fazer um diff de esquema por objeto, incluindo colunas, constraints, índices, funções, triggers, grants, RLS e policies; obter evidência de teste num ambiente isolado antes de planear qualquer correção.

## Consultas de verificação reproduzíveis (somente leitura)

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'participant_invitations', 'category_areas',
    'distinction_package_adoptions', 'magazine_editions',
    'magazine_features', 'magazine_images',
    'award_modality_categories', 'magazine_premium_spaces',
    'magazine_premium_editorials'
  )
order by table_name;

select proname,
       pg_get_functiondef(oid) ilike '%award_modality_categories%' as references_join
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'award_distinctions_validate', 'modality_votes_validate',
    'get_published_magazine', 'get_published_magazine_features',
    'get_published_magazine_feature_images'
  )
order by proname;
```

**Limite da verificação:** apenas nomes de objetos, presença de funções e referências textuais, além do histórico. Nenhuma comparação de hash de definição SQL ou de equivalência semântica foi efetuada nesta etapa.
