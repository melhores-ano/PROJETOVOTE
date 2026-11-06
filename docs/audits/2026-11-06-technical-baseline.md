# PROJETOVOTE — Baseline de auditoria técnica (2026-11-06)

> Estado: diagnóstico de leitura, sem alterações em produção. Esta documentação **não** autoriza executar migrations ou modificar permissões sem revisão.

## Infraestrutura identificada

- Repositório: `melhores-ano/PROJETOVOTE`, branch principal `main`.
- Supabase: projeto `agtgtcnwfrskvpegxoir` (Melhores do Ano Portugal).
- Frontend: React, TypeScript, Vite, Tailwind.
- Backend: Supabase PostgreSQL, Auth, Storage, RPCs e Edge Functions.
- Edge Functions identificadas como ativas: `cast-vote` e `cast-modality-vote`; ambas com `verify_jwt=false` (verificar defesas internas antes de qualquer conclusão de segurança).

## Dados observados (consultas somente leitura)

- 31 tabelas em `public` com RLS ativado.
- 1 campanha de 2026 em estado `votacao`, com `results_public=false`.
- 13 cidades, 40 categorias, 32 empresas, 30 participações.
- 12 votos principais e 4 votos por modalidade.
- 3 distinções, 2 credenciais digitais, 2 convites e 1 adesão comercial.
- 1 revista em estado `published`, 1 matéria, 2 espaços premium e 1 editorial premium.
- Cinco buckets públicos: `business-covers`, `business-logos`, `city-images`, `magazine-images`, `sponsor-logos`.

Contagens são um retrato pontual, não um indicador de completude funcional.

## Risco P0 — histórico de migrations divergente

O histórico remoto `supabase_migrations.schema_migrations` regista as versões `0001`–`0017`, enquanto o repositório contém ficheiros até `0024` (incluindo dois ficheiros com prefixo `0014`). Apesar disso, a base remota contém objetos de fases posteriores, incluindo tabelas de revista e premium. Verificações de leitura indicam que `award_distinctions_validate` e `modality_votes_validate` referenciam `award_modality_categories`, conforme o modelo multicategoria.

**Não executar `supabase db push`, reaplicar SQL ou marcar migrations como aplicadas sem comparar definições de tabelas, constraints, índices, funções, triggers, policies, grants e Storage.** O histórico remoto, por si só, não revela como os objetos foram criados.

### Procedimento de reconciliação proposto

1. Exportar e guardar um snapshot do esquema remoto, sem segredos nem dados pessoais.
2. Inventariar todas as migrations locais por nome, versão e dependências.
3. Comparar o SQL esperado com o estado real de cada objeto.
4. Classificar cada migration como equivalente, parcialmente aplicada, divergente ou ausente.
5. Propor um plano reversível, com backup verificado, testes em ambiente isolado e aprovação explícita antes de qualquer alteração em produção.

## Risco P0 — funções privilegiadas

Uma consulta a `pg_proc` identificou 31 funções `SECURITY DEFINER` em `public` para as quais `anon` tem `EXECUTE`. Isto **não demonstra exploração nem divulgação de dados**, porque funções podem validar permissões internamente. Exige análise prioritária das funções `get_admin_tally`, `get_admin_modality_tally`, `get_admin_vote_overview`, `get_admin_vote_timeline` e outras funções administrativas.

Também devem ser revistos os alertas do advisor relativos a `search_path` e índices de FKs.

### Verificações necessárias

- Inspecionar corpos das funções e confirmar autenticação/autorização efetiva.
- Distinguir RPCs públicas intencionais de RPCs exclusivamente administrativas.
- Verificar `REVOKE EXECUTE`/grants mínimos sem quebrar consumidores legítimos.
- Rever políticas de `storage.objects` e permissões de escrita nos buckets.
- Validar as Edge Functions de voto (rate limiting, CAPTCHA, replay, identidade e integridade transacional) em ambiente de testes.

## Estado funcional: evidência versus prova

O código e os dados demonstram módulos para votação, apuramento, administração, distinções, credenciais, convites, pacotes comerciais e revista. **Ainda não foram executados** testes ponta a ponta do login, votação, apuramento, publicação, uploads ou fluxos comerciais. O valor de 85% é uma estimativa fornecida pelo responsável do produto, não uma métrica auditada.

## Restrições de implementação

- Não modificar `main` nem fazer deploy sem aprovação.
- Não alterar esquema, políticas, funções, dados ou Storage de produção sem aprovação de impacto.
- Trabalhar em branches e Pull Requests, com testes e plano de rollback.
- Nunca colocar `service_role`, segredos ou dados pessoais em documentação/commits.

## Próxima entrega

Produzir uma matriz de equivalência das migrations `0018`–`0024`, uma matriz de privilégios das RPCs administrativas e um plano de testes de regressão por módulo. Só então preparar correções concretas.
