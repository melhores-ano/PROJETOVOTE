# Certificados e selos — artes oficiais (FASE 5C.3.16.1)

O motor visual (`src/config/credentialTemplates.ts` + `src/lib/credentialAssets.ts` +
`src/lib/credentialRenderer.ts`) lê os fundos oficiais DESTE diretório. Trocar os
ficheiros NÃO exige alterar lógica eleitoral, credenciais ou banco.

As artes são usadas byte-a-byte, sem redesenho, sem SVG/CSS, sem novo logótipo.

## Artes oficiais instaladas

| Ficheiro definitivo | Origem do proprietário | Dimensões reais |
|---|---|---|
| `certificate-background.png` | CERTIFICADO-FINALLIMPO.png | PNG 1754×1241 (≈ A4 landscape), preto + dourado, opaco |
| `seal-background.png` | SELO-TRANSP.png | PNG 1254×1254 quadrado, RGBA com transparência exterior (~33% pixels transparentes) |

## Estado atual (5C.3.16.1 — refinamento visual final, sem redesenho)

- `certificate-background.png` — INSTALADO → `CREDENTIAL_ASSET_STATUS.certificate = "official"`.
- `seal-background.png` — INSTALADO → `CREDENTIAL_ASSET_STATUS.seal = "official"`.
- O aviso "Arte oficial ainda não instalada — utilizando placeholder técnico."
  está OCULTO; o Admin mostra as artes reais.

## Estratégia de enquadramento (sem deformação)

- CERTIFICADO: `cover` centrado sobre o canvas A4 3508×2480. A arte
  (ratio ≈ 1.4134) é praticamente A4 landscape (ratio ≈ 1.4145): crop
  negligenciável nas extremidades. Crop sempre preferido a deformação.
  O PDF final continua A4 landscape via jsPDF.
- SELO: `contain` centrado sobre canvas 1080×1080 transparente. Proporção
  1:1 e transparência exterior preservadas — nunca fundo branco.

## Zona segura do certificado (arte real)

A arte já contém estrela, medalhão The Best Europa, título "Certificado" e
assinatura. Os campos dinâmicos vivem SÓ na zona preta segura centro/direita
(`contentArea`/`safeArea` em `credentialTemplates.ts`); `eyebrow`/`title` do
template servem SÓ o modo placeholder e nunca são desenhados sobre a arte.

## Selo limpo vs verificável (mesma credencial)

- LIMPO: arte oficial pura, sem QR, sem texto sobreposto.
- VERIFICÁVEL: medalhão oficial intacto e ligeiramente reduzido na faixa
  superior (contain em 0–74% da altura) + QR + verification_code +
  micro-legenda "Verificar autenticidade" discretos na faixa inferior
  transparente, FORA do medalhão. Só o próprio QR tem fundo técnico branco
  (contraste/leitura); o restante do canvas continua transparente.

## Fail-safe

Se um PNG oficial faltar no futuro, o renderer volta ao fundo técnico
provisório (`paintCertificatePlaceholder` / `paintSealPlaceholder`) e o
aviso reaparece — sem quebrar a página, sem tocar em votos, banco ou Storage.
