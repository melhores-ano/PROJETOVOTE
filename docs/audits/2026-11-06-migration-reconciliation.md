# Reconciliação de migrations — inventário verificável

Data: 2026-11-06. **Somente leitura.** Este documento é um plano de verificação, não uma autorização de deploy.

## Resultado confirmado

- O repositório contém **25 ficheiros SQL** em `supabase/migrations`, mas apenas **24 prefixos numéricos distintos**, pois há dois ficheiros `0014_*`.
- O histórico remoto de `supabase_migrations.schema_migrations` contém **17 versões**: `0001` até `0017`.
- Não interpretar a ausência de `0018`–`0024` no histórico como ausência dos objetos. A base remota já contém estruturas dessas fases.
- As funções remotas `award_distinctions_validate` e `modality_votes_validate` referenciam `award_modality_categories`, indício de que lógica multicategoria foi aplicada fora do histórico normal.

## Inventário de ficheiros com versão posterior ao histórico remoto

| Ficheiro | Área | Evidência remota | Classificação |
|---|---|---|---|
| `0018_phase61_participant_invitations.sql` | Convites | 2 registos em `participant_invitations` | Objetos presentes; equivalência SQL não verificada |
| `0019_phase62_category_areas.sql` | Áreas de categorias | `category_areas` no esquema | Objetos presentes; equivalência SQL não verificada |
| `0020_phase631_digital_package_adoptions.sql` | Adesões comerciais | 1 registo em `distinction_package_adoptions` | Objetos presentes; equivalência SQL não verificada |
| `0021_phase641_magazine_foundation.sql` | Edições, matérias e imagens | Tabelas de revista e 1 edição publicada | Objetos presentes; equivalência SQL não verificada |
| `0022_phase642_magazine_public_read.sql` | RPCs públicas de revista | Exige inspeção de assinaturas, corpos e grants | Por verificar |
| `0023_phase66_multicategory_modality_validation.sql` | Validação de votos por modalidade | Função remota referencia associação N:N | Indício de aplicação; equivalência não verificada |
| `0024_phase66_multicategory_distinction_validation.sql` | Validação de distinções | Função remota referencia associação N:N | Indício de aplicação; equivalência não verificada |

## Anomalia de versionamento anterior

Existem dois ficheiros com prefixo `0014`:
- `0014_phase5c38_award_modalities.sql`
- `0014_phase65_catalog_pt_areas_categories.sql`

O histórico remoto `0014` identifica apenas `phase5c38_award_modalities`. **Não renomear, apagar, executar ou marcar** o segundo ficheiro como aplicado sem examinar a sua intenção, dependências e objetos efetivos. O prefixo duplicado pode quebrar fluxos automatizados de migrations.

## Critérios de conclusão por migration

1. Comparar tabelas, colunas, tipos, defaults, constraints e FKs.
2. Comparar índices, triggers e definições completas de funções.
3. Comparar RLS, policies, owners e privilégios `EXECUTE`.
4. Verificar Storage: buckets, policies e dependências.
5. Verificar dados de referência esperados sem alterar dados existentes.
6. Classificar como **equivalente**, **parcial**, **divergente** ou **ausente**, anexando evidência de cada decisão.

## Regra de execução

**Proibido executar `db push`, `migration repair` ou SQL de correção na produção antes de**: snapshot e backup verificados, revisão das diferenças, teste em ambiente isolado e aprovação explícita do responsável pelo produto.

## Próxima análise

- Auditar especificamente `0014_phase65_catalog_pt_areas_categories.sql` e a sua ordem/dependências.
- Inspecionar grants e verificações de autorização nas RPCs administrativas.
- Criar testes automatizados não destrutivos que identifiquem deriva do esquema.
