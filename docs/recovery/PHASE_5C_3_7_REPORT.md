# FASE 5C.3.7 — ISOLAMENTO COMPLETO DO ADMIN POR PROGRAMA / EDIÇÃO

FASE: 5C.3.7

## CONTEXTO ADMIN

Única fonte: `AdminProgramProvider` / `useAdminProgram()` (sem segundo
contexto paralelo). Programa selecionado determina `selectedProgram`,
`selectedProgramId` e `country_code`; edição selecionada determina
`selectedCampaign` / `selectedCampaignId`. Todas as 7 páginas auditadas
(Cidades, Categorias, Empresas, Patrocinadores, Importar CSV, Painel,
Configurações) consomem este contexto + nova faixa visual
`AdminScopeBanner` (PROGRAMA · País · EDIÇÃO). FAIL-CLOSED: sem programa
válido → listas vazias + alerta, sem fallback silencioso para Portugal;
operação que exige campaign sem campaign válida → bloqueada com mensagem.

## CIDADES

`useScopedCities(countryCode)` — `.eq('country_code', countryCode)` +
filtro cliente `belongsToCountry`, sem UUID hardcoded (PT resolve via
programa). Criação deriva `country_code` do programa (campo não editável,
exibido no modal); edição nunca muda o país (recusada se cidade de outro
país). Cidades existentes intactas. Coluna "País" adicionada à tabela.

## CATEGORIAS

`useScopedCategories(programId)` — `.eq('award_program_id', programId)` +
filtro cliente `belongsToProgram`. Criação deriva `award_program_id` +
`locale` do programa (exibidos no modal); edição de categoria de outro
programa recusada. As 8 categorias existentes de Portugal intactas. Coluna
"Locale" adicionada à tabela.

## EMPRESAS

`useScopedBusinesses(countryCode)` — carrega `businesses + city` e filtra
`city.country_code = país do programa` (city_id NULL ou outro país →
excluída; sem `award_program_id` artificial). Seletor de cidade no
formulário lista SOMENTE cidades do programa; gravação com cidade fora do
programa recusada (fail-closed). Chips de categoria limitados às categorias
do programa. Empresa ≠ participação: ligação empresa+edição+categoria
permanece em `campaign_entries`; mudar de edição nunca duplica. Coluna
"Cidade" adicionada à tabela.

## PATROCINADORES

`useScopedSponsors(programId)` — `NULL (global The Best Europa) OU =
programa`; outro programa excluído (filtro `isSponsorVisible`). Coluna
"Âmbito" com selo visual: `Global — The Best Europa` (azul) vs
`Programa — Melhores do Ano Portugal` (dourado). Criação/edição permite
SOMENTE Global (NULL) ou programa atual via seletor "Âmbito"; sem outros
programas. Edição de patrocinador de outro programa recusada/não listada.

## IMPORTAR CSV

Lookups ESTRITAMENTE do programa (`useScopedCities`/`useScopedCategories`);
lista de edições = `campaigns` do contexto (edição via seletor global,
combo local só-leitura). Validações fail-closed: sem programa → página
bloqueada; cidade fora do programa → linha ignorada (nada criado); categoria
fora do programa → linha ignorada; inscrição com `linkEntries` sem
`selectedCampaignId` → botão bloqueado + alerta; edição de outro programa →
importação recusada. Auditoria `import_batch` regista `award_program_id` +
`campaign_id`. Nenhuma importação real executada nesta fase.

## DASHBOARD

Votos/timeline/ranking usam `selectedCampaignId` (campaign-scoped);
cidades/categorias/empresas usam `selectedProgramId`/`country_code`
(program-scoped, hooks scoped). Ranking filtra cidades/categorias fora do
programa (`belongsToCountry`/`belongsToProgram`). Sem programa válido →
`ErrorState` fail-closed. Faixa `AdminScopeBanner requireCampaign` + KPIs
rotulados com programa/país/edição. Sem soma entre programas.

## CONFIGURAÇÕES

Arquitetura 0012 preservada: chaves POR PROGRAMA
(`active_campaign_slug`, `voting_enabled`, `results_visible`,
`voting_rules`, `turnstile_enabled`) → `award_program_id =
selectedProgramId`; chaves GLOBAIS → NULL. Leitura e escrita migradas de
`resolveCurrentProgramId` (slug PT fixo) para `selectedProgramId` do
contexto Admin. `active_campaign_slug` continua POR PROGRAMA; nada
transformado em config de edição. Nenhum valor existente alterado; gravação
bloqueada sem programa válido + faixa de scope.

MIGRATION NECESSÁRIA:
NÃO
Schema 0011 (countries, award_programs, campaigns.award_program_id UNIQUE
(programa,ano), cities.country_code, categories.award_program_id+locale,
sponsors.award_program_id NULL, site_settings.award_program_id) + 0012
(PK técnica, UNIQUEs parciais global/por programa, backfill PT) já cobre
todo o isolamento; 0013 restaura RPCs de resultados. Nenhuma coluna nova
necessária (empresas via cidade; edições via campaign_entries).

2027 CRIADO:
NÃO

NOVO PAÍS/PROGRAMA CRIADO:
NÃO

BANCO REMOTO ALTERADO:
NÃO

CAST-VOTE SHA256:
F8D382B2F0B6FD2AFB4E742275AA4297266AFDE5A398B4B4258787027FE6115C

HASH CONFERE:
SIM

BUILD:
OK — `npm run build` (tsc + vite build) concluído com sucesso
(`✓ built in 4.90s`), sem erros de tipo.

TESTES:
- test:voting → 24 passed, 0 failed
- test:results → 47 passed, 0 failed
- test:csv → 17 passed, 0 failed
Backend de votação, antifraude, RPCs e CSV intactos. Sem testes
destrutivos; sem edição temporária; banco remoto intocado. Rotas Admin sem
prefixo /pt/; sem `/pt/pt/` (grep vazio em App.tsx).

FICHEIROS CRIADOS:
- src/lib/adminScope.ts (guardas fail-closed + sponsorScopeLabel)
- src/components/AdminScopeBanner.tsx (faixa PROGRAMA·País·EDIÇÃO)
- docs/recovery/PHASE_5C_3_7_REPORT.md (este relatório)

FICHEIROS ALTERADOS:
- src/hooks/useAdminData.ts (useScopedCities, useScopedCategories,
  useScopedBusinesses, useScopedSponsors; imports belongsTo*/isSponsorVisible/Sponsor)
- src/pages/admin/CitiesAdminPage.tsx (scope country_code + create/edit fail-closed)
- src/pages/admin/CategoriesAdminPage.tsx (scope award_program_id + locale)
- src/pages/admin/BusinessesAdminPage.tsx (scope via cidade + city selector scoped)
- src/pages/admin/SponsorsAdminPage.tsx (scope global/programa + selo Âmbito)
- src/pages/admin/CsvImportPage.tsx (lookups scoped + campaign obrigatória p/ entries)
- src/pages/admin/DashboardPage.tsx (métricas campaign/program-scoped + banner)
- src/pages/admin/SettingsAdminPage.tsx (programa via contexto em vez de slug PT fixo)

LIMITAÇÕES:
- Preview sem Supabase usa fallbacks locais PT (modo demonstração; sem backend real).
- Dedup de slugs no CSV (`businesses.slug`) mantém verificação global — slug continua globalmente único (constraint 0001 preservada na 0011).
- `useAllCities/useAllCategories/useAllBusinesses` legados mantidos para compatibilidade (nenhuma página em scope os usa após esta fase).
- Validação de Portugal/2026-ativa/6 participações/votos é leitura remota (não executada: sem escrita/testes destrutivos nesta fase).

RESULTADO FINAL:
5C.3.7 IMPLEMENTADA
