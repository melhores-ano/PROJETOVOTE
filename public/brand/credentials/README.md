# Certificados e selos — templates oficiais (FASE 5C.3.15)

O motor visual (`src/config/credentialTemplates.ts` + `src/lib/credentialAssets.ts` +
`src/lib/credentialRenderer.ts`) lê os fundos oficiais DESTE diretório. Trocar os
ficheiros NÃO exige alterar lógica eleitoral, credenciais ou banco.

## Onde colocar a arte oficial limpa

| Ficheiro definitivo | Caminho exato | Formato esperado |
|---|---|---|
| Certificado The Best Europa (fundo limpo, SEM dados da empresa, SEM texto/datas/assinaturas) | `public/brand/credentials/certificate-background.png` | PNG, A4 horizontal (landscape), idealmente 3508×2480 (300dpi), preto + dourado |
| Selo The Best Europa (medalhão limpo) | `public/brand/credentials/seal-background.png` | PNG com transparência, idealmente 1080×1080 |

## Estado atual

- `certificate-background.png` — AINDA NÃO colocado → o motor usa fundo técnico provisório.
- `seal-background.png` — AINDA NÃO colocado → o motor usa medalhão técnico provisório.

ARTE OFICIAL PENDENTE DE INSTALAÇÃO (ambos os caminhos acima).

## Ativação (quando os PNGs limpos chegarem)

1. Colocar `certificate-background.png` neste diretório (arte limpa: fundo,
   estrela, elementos dourados, medalhão The Best Europa; SEM empresa antiga,
   SEM texto antigo, SEM data/assinatura, SEM SHOP SHOW MARKETING).
2. Colocar `seal-background.png` neste diretório (medalhão circular dourado,
   fundo interior verde muito escuro/preto, estrela, THE BEST EUROPA, louros,
   três estrelas inferiores; PNG com transparência).
3. Em `src/config/credentialTemplates.ts`, mudar `CREDENTIAL_ASSET_STATUS`
   para `{ certificate: "official", seal: "official" }`.
4. O aviso "Arte oficial ainda não instalada — utilizando placeholder técnico."
   desaparece automaticamente; o sistema passa a usar as artes oficiais.

## Notas

- NÃO redesenhar a identidade. NÃO criar imitação do certificado nem novo
  logótipo. Placeholders técnicos continuam até os PNGs oficiais limpos.
- A arte de referência do proprietário (ex.: dados antigos de terceiros) NÃO
  faz parte do template — os dados são sempre dinâmicos (nome, programa,
  edição, cidade, categoria, modalidade, código, data, URL de verificação).
- Selo limpo (sem QR, p/ website/redes/publicidade) e selo verificável (com
  QR discreto) derivam da MESMA digital_credential — sem duplicar credenciais.
- Geração 100% client-side, determinística, sem Storage/bucket novo.
- Ciclos de continuação: fase revalidada (verificador 42/42, tsc limpo) sem
  alterações funcionais; placeholders mantidos até receção dos PNGs oficiais.
