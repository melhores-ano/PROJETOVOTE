# Divergência confirmada — catálogo de áreas e categorias (2026-11-06)

**Fonte:** consulta SQL somente leitura ao projeto Supabase `agtgtcnwfrskvpegxoir`, comparada com `supabase/migrations/0014_phase65_catalog_pt_areas_categories.sql`.

## Resultado

O programa `melhores-do-ano-portugal` possui as oito áreas esperadas e **40 categorias**, mas três categorias existentes têm `area_id IS NULL`:

| Categoria | Slug | Área pretendida pelo SQL local |
|---|---|---|
| Cafés | `cafes` | `restauracao-gastronomia` |
| Ginásios | `ginasios` | `saude-bem-estar` |
| Salões de Beleza | `saloes-de-beleza` | `beleza-estetica` |

As restantes 37 categorias estão associadas a áreas. A existência das 32 categorias novas e das oito áreas é compatível com parte do seed local, mas **não demonstra que a migration tenha sido executada integralmente**.

O ficheiro local contém `UPDATE categories ... WHERE lower(btrim(c.name)) IN (...)` que deveria atribuir as três áreas; também contém uma validação final que abortaria se estas categorias permanecessem com `area_id IS NULL`. Portanto, **o estado remoto não corresponde ao estado final esperado pela migration**. A origem exata da divergência (execução parcial/manual, importação posterior ou alteração subsequente) ainda não foi estabelecida.

## Risco e decisão

- **Bloqueio de reconciliação confirmado:** a segunda migration com prefixo `0014` não deve ser marcada como aplicada nem reaplicada cegamente.
- Não renomear o ficheiro original nem inserir versões no histórico de migrations enquanto houver duplicação de prefixo e objetos remotos pré-existentes.
- **Não atualizar as três categorias na produção sem aprovação explícita**, backup e teste isolado. A atribuição pretendida é clara, mas a alteração de dados pode afetar filtros, relatórios e integrações.
- Preparar uma migration de reparação **nova, específica e idempotente**, com preflight para confirmar IDs, programa, áreas e ausência de vínculos inesperados; testar num ambiente isolado.
- Validar posteriormente que as 40 categorias do programa possuem `area_id` correto e que os resultados eleitorais e associações existentes permanecem intactos.

## Consulta de verificação (somente leitura)

```sql
select c.id, c.slug, c.name, a.slug as area_slug
from public.categories c
join public.award_programs p on p.id = c.award_program_id
left join public.category_areas a on a.id = c.area_id
where p.slug = 'melhores-do-ano-portugal'
  and c.slug in ('cafes', 'ginasios', 'saloes-de-beleza')
order by c.slug;
```

**Produção não modificada nesta auditoria.**
