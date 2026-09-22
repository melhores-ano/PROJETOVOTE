# Certificados e selos — templates oficiais (FASE 5C.3.14)

O motor visual (`src/config/credentialTemplates.ts` + `src/lib/credentialRenderer.ts`)
lê os fundos oficiais DESTE diretório. Trocar os ficheiros NÃO exige alterar
lógica eleitoral, credenciais ou banco.

## Onde colocar a arte oficial limpa

| Ficheiro definitivo | Caminho exato | Formato esperado |
|---|---|---|
| Certificado The Best Europa (fundo limpo, SEM dados da empresa, SEM texto/datas/assinaturas) | `public/brand/credentials/certificate-background.png` | PNG, A4 horizontal (landscape), idealmente 3508×2480 (300dpi), preto + dourado |
| Selo The Best Europa (medalhão limpo) | `public/brand/credentials/seal-background.png` | PNG com transparência, idealmente 1080×1080 |

## Estado atual

- `certificate-background.png` — AINDA NÃO colocado → o motor usa fundo técnico provisório.
- `seal-background.png` — AINDA NÃO colocado → o motor usa medalhão técnico provisório.

NÃO redesenhar a identidade nesta fase. Quando os ficheiros limpos forem
colocados nos caminhos acima, o motor passa a usá-los automaticamente.

## Notas

- A arte de referência do proprietário (ex.: dados antigos de terceiros) NÃO
  faz parte do template — os dados são sempre dinâmicos (nome, programa,
  edição, cidade, categoria, modalidade, código, data, URL de verificação).
- Geração 100% client-side, determinística, sem Storage/bucket novo.
