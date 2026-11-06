# Verificação de policies e triggers — 2026-11-06

Comparação por **nome e presença** entre migrations 0018–0021 e consultas remotas somente leitura.

## Policies RLS

As sete policies de `public` previstas nas migrations estão presentes no Supabase:
- `participant_invitations`: admin manage participant_invitations
- `category_areas`: public read active category_areas; admin manage category_areas
- `distinction_package_adoptions`: admin manage distinction_package_adoptions
- `magazine_editions`: admin manage magazine_editions
- `magazine_features`: admin manage magazine_features
- `magazine_images`: admin manage magazine_images

## Triggers

Os triggers previstos também estão presentes: três em participant_invitations; category_areas_touch e trg_category_areas_audit em category_areas; trg_categories_check_area_scope em categories; dois em distinction_package_adoptions; três em magazine_editions; três em magazine_features; um em magazine_images. O resultado de information_schema.triggers pode repetir um trigger por evento, portanto as linhas duplicadas **não indicam triggers duplicados**.

## Limites

A comparação de nomes **não valida** expressões USING/WITH CHECK das policies, definição dos triggers, ordem de execução, funções associadas, índices não-PK ou permissões. A reconciliação integral permanece pendente. Não executar migrations nem alterar o histórico sem testes e aprovação.
