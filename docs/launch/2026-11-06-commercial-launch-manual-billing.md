# Plano de lançamento comercial — faturação manual / transferência bancária

Estado: plano operacional; **não é autorização para produção**. Data: 2026-11-06.

## Decisão de produto
Vender participações, distinções, certificados/selos, placas/troféus, patrocínios, publicidade e espaços da Revista Digital. Cobrança por **fatura emitida fora do site + transferência bancária**, com reconciliação humana. Não desenvolver checkout, gateways, nem guardar dados bancários sensíveis no frontend.

## Evidência no código (não equivale a homologação)
- `src/pages/admin/DistinctionsAdminPage.tsx`: pipeline comercial `pending/contacted/accepted/confirmed/declined/cancelled`, fulfillment separado do mérito e integração de `downloadCertificatePdf`/`downloadSealPng`.
- `src/pages/admin/SponsorsAdminPage.tsx`: gestão de patrocinadores, **não** faturação.
- `src/pages/admin/MagazineAdminPage.tsx`: gestão/publicação de edições.
- `src/pages/public/VerifyPage.tsx`: verificação pública de credenciais.
- **Atenção:** alterações locais não versionadas na revista e migrações 0025–0029 não foram inspecionadas neste repositório remoto. Nunca fazer pull/reset/switch no PC sem backup.

## Bloqueadores verificáveis (P0)
| ID | Entrega | Aceitação objetiva | Estado |
|---|---|---|---|
| P0-01 | Snapshot local seguro | Backup de ficheiros tracked/untracked, manifesto e build local; sem perda de alterações | Pendente — exige acesso à máquina |
| P0-02 | Candidato de release | Diff local vs branch de auditoria revisto; migrations 0025–0029 inventariadas; sem deploy | Pendente |
| P0-03 | Segurança e votos | Testes de RLS, papéis admin, voto duplicado, captcha, contagem, publicação, revogação em ambiente isolado | Pendente |
| P0-04 | Produtos e preço | Tabela aprovada de SKU, preço, IVA aplicável, condições, prazo de entrega e responsável | Pendente — decisão comercial |
| P0-05 | Cobrança manual | Identificador único da proposta/encomenda, cliente, produto, valor, estado da fatura, referência de transferência, conciliação e prova de entrega; evitar dados bancários desnecessários | Pendente |
| P0-06 | Não interferência eleitoral | Pagamento/recusa nunca muda votos, classificação, mérito ou publicação de resultados | Pendente — teste E2E |
| P0-07 | Entrega | Certificado PDF/selo PNG com QR verificável; entrega de físico; publicidade e revista publicados conforme contrato | Pendente — teste E2E |
| P0-08 | Revista premium | Validar migrações 0025–0029, permissões editoriais, preview, upload, publicação, leitura mobile e rollback | Pendente |
| P0-09 | Produção resiliente | Backup restaurável, DNS/TLS, monitorização, contacto de suporte e procedimento de reversão | Pendente |
| P0-10 | Conformidade | Rever RGPD, consentimentos, termos, condições de venda, publicidade e faturação com contabilista/jurista PT | Pendente |

## Fluxo mínimo de encomenda sem pagamentos online
1. Comercial seleciona SKU e preço aprovado; gera proposta numerada com validade e condições.
2. Cliente aceita por canal documentado; registar consentimentos e contactos estritamente necessários.
3. Emitir fatura no sistema de faturação apropriado, fora do PROJETOVOTE.
4. Enviar instruções de transferência por canal seguro; não recolher credenciais bancárias.
5. Conferir extrato bancário **manualmente**; marcar `paid` apenas após confirmação humana, com operador/data/referência não sensível.
6. Autorizar produção/entrega do item contratado; registar entrega e evidência.
7. Cancelamento/reembolso: conciliar com a contabilidade; não apagar histórico.
8. Mérito e resultados eleitorais permanecem independentes da venda.

**Não confundir `commercial_status=confirmed` com pagamento recebido**. Não usar esse estado como confirmação financeira.

## Ordem de execução
- **Sprint A — proteger**: P0-01, P0-02; nenhum merge, DB write ou deploy.
- **Sprint B — fechar operação**: P0-04, P0-05, P0-06; primeiro definir se será livro de encomendas externo ou módulo admin restrito. Preferir processo externo mínimo para lançamento.
- **Sprint C — validar produto**: P0-03, P0-07, P0-08; testes em ambiente isolado.
- **Sprint D — go/no-go**: P0-09, P0-10 e uma venda fictícia ponta-a-ponta com evidências; aprovação explícita antes de deploy.

## Adiável (P1)
Checkout e pagamentos online, automação de faturação, CRM avançado, novos efeitos 3D, novas variantes gráficas, relatórios avançados, expansão internacional e renumeração histórica sem impacto operacional imediato.

## Restrições técnicas
- Não aplicar `supabase db push`/`migration repair` até reconciliar efeitos das migrações relevantes e testar.
- Não alterar `main`, não executar SQL de escrita em produção e não criar versões 0025–0029 no GitHub que colidam com as locais.
- Qualquer futuro módulo de cobranças deve ter RLS admin-only, trilho de auditoria, controlo de estados e separação rigorosa de voto/mérito.
