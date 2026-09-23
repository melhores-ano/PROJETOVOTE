/**
 * THE BEST EUROPA — FASE 5C.3.16.2 — Configuração central dos templates visuais.
 *
 * ÚNICA fonte de verdade visual para certificados e selos:
 *   credentialTemplates.ts → configuração (geometria, tipografia, assets)
 *   credentialAssets.ts     → estado do asset (placeholder | official)
 *   credentialRenderer.ts   → renderização
 *   CredentialPreview       → visualização
 *   DistinctionsAdminPage   → ações operacionais
 *
 * Nenhum número mágico fora deste ficheiro: dimensões, coordenadas (0–1
 * normalizadas), tipografia, tamanhos, posições de QR e código.
 *
 * TEMPLATES DEFINITIVOS (artes oficiais instaladas na 5C.3.16, INTACTAS na 5C.3.16.1):
 *   /brand/credentials/certificate-background.png  (A4 landscape, 1754×1241)
 *   /brand/credentials/seal-background.png         (medalhão, PNG c/ transparência, 1254×1254)
 * O motor usa SOMENTE estes dois caminhos oficiais. O mecanismo de
 * placeholder técnico continua como fail-safe (ver ASSET_PLACEHOLDER e
 * CREDENTIAL_ASSET_STATUS): se um PNG oficial faltar no futuro, o renderer
 * volta ao fundo provisório sem quebrar a página.
 *
 * NÃO reconstruir artisticamente as artes via CSS/SVG. NÃO criar imitação do
 * certificado. NÃO criar novo logótipo. NÃO modificar a identidade The Best
 * Europa. Os PNGs são usados byte-a-byte, sem redesenho. A 5C.3.16.1 NÃO
 * redesenha estrela, medalhão, título "Certificado", assinatura nem
 * decoração dourada — refina SÓ a distribuição do conteúdo dinâmico.
 *
 * 5C.3.16 — coordenadas revistas para a ARTE REAL:
 *   Certificado: a arte já contém estrela, medalhão, título "Certificado" e
 *   assinatura. Os campos dinâmicos vivem SÓ na zona preta segura
 *   centro/direita (contentArea/safeArea); eyebrow/title do template servem
 *   apenas o modo placeholder e NÃO são desenhados sobre a arte oficial.
 *   Enquadramento: cover (pequeno crop preferido a deformação — SEM deformar,
 *   crop negligenciável preferido a deformação).
 *   Selo: contain sobre canvas transparente (proporção e transparência
 *   preservadas); selo limpo = arte pura; selo verificável = composição
 *   vertical transparente (medalhão intacto em cima + QR/código/legenda
 *   FORA do medalhão, em baixo).
 *
  * 5C.3.16.2 — CORREÇÃO FINAL DO BLOCO DE AUTENTICAÇÃO (sem redesenho):
  *   Certificado em duas zonas (referência visual aprovada, geometria só):
  *   - ÁREA SUPERIOR/CENTRAL: intro + nome (124px @300dpi, auto-fit min
  *     52px max 2 linhas, nunca sai da safe area) + corpo com respiro
  *     (line-height 1.5, termina em y 0.59, ANTES da autenticação).
  *   - ÁREA INFERIOR DIREITA (à DIREITA da assinatura, assinatura isolada
  *     à esquerda/centro): bloco 4 linhas à esquerda do QR
  *     ("Código de verificação:" / valor / "Data de emissão:" / valor,
  *     x 0.545–0.76) + QR em coluna própria (x 0.775–0.89, y 0.625–0.775,
  *     lado ≈370px, leitura smartphone) + "Verificar autenticidade"
  *     imediatamente abaixo do QR (y 0.78). Margem visual clara entre
  *     corpo e autenticação (gap 0.035). QR NUNCA ao lado/por cima do
  *     texto principal. Edition NÃO desenhada sobre a arte oficial
  *     (só placeholder).
  *   Selo limpo: INTACTO (arte pura, qr=null, qrCaption=null).
  *   Selo verificável: INTACTO nesta intervenção (sem alterações).
 *
 * PT-PT. Sem votos, sem ranking, sem pagamentos, sem 2027, sem novo país,
 * sem migration 0018.
 */

export type CredentialTemplateKind = 'certificate' | 'seal';

/** Estado explícito do asset — fonte de verdade (sem chamadas de rede). */
export type CredentialAssetStatus = 'placeholder' | 'official';

/** Caixa normalizada (0–1) relativa à área útil do canvas. */
export interface TemplateBox {
  x: number;
  y: number;
  w: number;
  h: number;
  align?: 'left' | 'center' | 'right';
}

export interface TemplateTypography {
  family: string;
  color: string;
  sizePxAt300dpi: number;
  weight?: number;
  letterSpacingPx?: number;
  uppercase?: boolean;
}

export interface CertificateTemplateConfig {
  kind: 'certificate';
  /** A4 landscape @300dpi: 3508 × 2480. */
  widthPx: number;
  heightPx: number;
  format: 'A4';
  orientation: 'landscape';
  backgroundPath: string;
  fallbackBackgroundPath: string | null;
  /**
   * 5C.3.16 — enquadramento da arte oficial sobre o canvas A4:
   * "cover" = preencher sem deformar (pequeno crop nas extremidades
   * preferido a deformação). A arte oficial (1754×1241, ratio ≈1.4134) é
   * praticamente A4 landscape (ratio ≈1.4145): crop negligenciável.
   */
  backgroundFit: 'cover';
  /** Área segura principal (zona preta à direita da arte oficial). */
  contentArea: TemplateBox;
  /** Área segura total do texto (nunca sair daqui). */
  safeArea: TemplateBox;
  fields: {
    eyebrow: TemplateBox & { typography: TemplateTypography };
    title: TemplateBox & { typography: TemplateTypography };
    intro: TemplateBox & { typography: TemplateTypography };
    recipientName: TemplateBox & {
      typography: TemplateTypography;
      /** Redução automática para nomes longos. */
      minSizePxAt300dpi: number;
      maxLines: number;
    };
    body: TemplateBox & { typography: TemplateTypography };
    verificationCode: TemplateBox & { typography: TemplateTypography };
    qrCaption: TemplateBox & { typography: TemplateTypography };
    issuedAt: TemplateBox & { typography: TemplateTypography };
    edition: TemplateBox & { typography: TemplateTypography };
    /**
     * 5C.3.16.2 — Bloco de autenticação inferior direito (4 linhas,
     * à esquerda do QR, mesma zona inferior direita):
     *   "Código de verificação:" / valor / "Data de emissão:" / valor.
     * Texto principal termina ANTES desta zona (margem visual clara).
     * Assinatura (esquerda/centro) permanece isolada — este bloco vive
     * SÓ à direita (x >= 0.545), QR em coluna própria (x >= 0.775).
     */
    verificationCodeLabel: TemplateBox & { typography: TemplateTypography };
    verificationCodeValue: TemplateBox & { typography: TemplateTypography };
    issuedAtLabel: TemplateBox & { typography: TemplateTypography };
    issuedAtValue: TemplateBox & { typography: TemplateTypography };
  };
  qr: TemplateBox & { marginPx: number };
  margins: { top: number; right: number; bottom: number; left: number };
  revokedWatermark: { text: string; typography: TemplateTypography; angleDeg: number };
}

export type SealVariant = 'clean' | 'verifiable';

export interface SealTemplateConfig {
  kind: 'seal';
  /** 1080 × 1080 para web/redes/assinatura. */
  widthPx: number;
  heightPx: number;
  backgroundPath: string;
  fallbackBackgroundPath: string | null;
  /** Variante: clean (sem QR) ou verifiable (com QR discreto). */
  variant: SealVariant;
  /** PNG com transparência — nunca preencher fundo branco. */
  transparent: boolean;
  /**
   * 5C.3.16 — enquadramento da arte oficial: "contain" centrado sobre
   * canvas transparente (preserva proporção 1:1 e transparência exterior;
   * nunca esticar, nunca fundo branco).
   */
  backgroundFit: 'contain';
  fields: {
    brandLine: TemplateBox & { typography: TemplateTypography };
    programLine: TemplateBox & { typography: TemplateTypography };
    yearLine: TemplateBox & { typography: TemplateTypography };
    distinctionLine: TemplateBox & {
      typography: TemplateTypography;
      minSizePxAt300dpi: number;
      maxLines: number;
    };
  };
  qr: (TemplateBox & { marginPx: number }) | null;
  verificationCode: TemplateBox & { typography: TemplateTypography };
  /**
   * 5C.3.16 — micro-legenda "Verificar autenticidade" do selo verificável
   * oficial (discreta, sobre o aro inferior, fora do medalhão central).
   * null no selo limpo (arte pura, sem texto).
   */
  qrCaption: (TemplateBox & { typography: TemplateTypography }) | null;
  revokedWatermark: { text: string; typography: TemplateTypography; angleDeg: number };
}

export const CREDENTIAL_ASSETS = {
  dir: '/brand/credentials/',
  certificateBackground: '/brand/credentials/certificate-background.png',
  sealBackground: '/brand/credentials/seal-background.png',
  readme: '/brand/credentials/README.md',
} as const;

/**
 * Placeholder técnico claramente identificado (usado SOMENTE quando o asset
 * oficial ainda não foi colocado no projeto). Nunca redesenha a identidade.
 */
export const ASSET_PLACEHOLDER = {
  certificate: true,
  seal: true,
  notice:
    'Template oficial ainda não colocado — a usar fundo técnico provisório. ' +
    'Coloque certificate-background.png e seal-background.png em /brand/credentials/.',
} as const;

/**
 * 5C.3.16 — Estado explícito dos assets (fonte de verdade, sem rede).
 *
 * "placeholder" → PNG oficial em falta → renderer + preview usam fundo
 *   técnico provisório e mostram o aviso
 *   "Arte oficial ainda não instalada — utilizando placeholder técnico."
 * "official" → PNG oficial instalado no caminho definitivo → aviso
 *   ocultado, arte oficial domina a composição.
 *
 * ARTES OFICIAIS INSTALADAS (certificate-background.png 1754×1241,
 * seal-background.png 1254×1254 com transparência). O fail-safe continua:
 * se um PNG faltar no futuro, o renderer volta ao placeholder sem quebrar.
 */
export const CREDENTIAL_ASSET_STATUS: Record<'certificate' | 'seal', CredentialAssetStatus> = {
  certificate: 'official',
  seal: 'official',
} as const;

export const OFFICIAL_ASSET_NOTICE =
  'Arte oficial ainda não instalada — utilizando placeholder técnico.';

export function isOfficialAsset(kind: 'certificate' | 'seal'): boolean {
  return CREDENTIAL_ASSET_STATUS[kind] === 'official';
}

export function isPlaceholderAsset(kind: 'certificate' | 'seal'): boolean {
  return !isOfficialAsset(kind);
}

/**
 * 5C.3.15 — Texto institucional PT-PT curto e premium.
 * Sem texto antigo de terceiros (nada de "gerando empregos..." nem
 * referências ao município do certificado ASTEC).
 */
export const CREDENTIAL_COPY = {
  headline: 'Certificado',
  intro: 'Conferimos o presente certificado a:',
  recognition:
    'Em reconhecimento pelo mérito e destaque alcançados na sua área de atividade,',
  qrCaption: 'Verificar autenticidade',
  placeholderNotice: OFFICIAL_ASSET_NOTICE,
} as const;

const GOLD = '#C8A24B';
const GOLD_LIGHT = '#E8C97A';
const INK = '#F5EFE0';
const MUTED = '#B9B2A0';

/**
 * Fontes web existentes/licenciadas no projeto (sem fontes externas
 * desconhecidas). Georgia cobre Á, É, Í, Ó, Ú, Ç, Ã, Õ, Ê e restantes
 * acentos PT-PT.
 */
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = '"Courier New", monospace';
const SANS = 'Arial, sans-serif';

export const CERTIFICATE_TEMPLATE: CertificateTemplateConfig = {
  kind: 'certificate',
  widthPx: 3508,
  heightPx: 2480,
  format: 'A4',
  orientation: 'landscape',
  backgroundPath: CREDENTIAL_ASSETS.certificateBackground,
  fallbackBackgroundPath: null,
  backgroundFit: 'cover',
  // 5C.3.16.2 — ARTE REAL INTACTA (1754×1241): estrela + medalhão à
  // esquerda (x < 0.50), título "Certificado" em cima à direita (y < 0.33),
  // assinatura isolada em baixo à esquerda/centro (y > 0.78, x < 0.68),
  // filetes dourados nas extremidades (x > 0.93). Composição em duas zonas:
  //   ÁREA SUPERIOR/CENTRAL (texto principal, termina ANTES da autenticação):
  //     intro (y 0.345) + nome (0.385–0.485, auto-fit) + corpo (0.49–0.59).
  //   ÁREA INFERIOR DIREITA (autenticação, à DIREITA da assinatura):
  //     bloco 4 linhas à esquerda do QR (x 0.545–0.76, y 0.635–0.761)
  //     + QR em coluna própria (x 0.775–0.89, y 0.625–0.775)
  //     + "Verificar autenticidade" imediatamente abaixo do QR (y 0.78).
  // Margem visual clara entre corpo (fim 0.59) e autenticação (início 0.625):
  // gap 0.035 (~87px @300dpi). QR NUNCA ao lado/por cima do texto principal.
  // NUNCA escrever sobre estrela, medalhão, título, assinatura ou filetes.
  // Auto-fit do nome preservado (min 52px, max 2 linhas). SEM edition sobre
  // a arte oficial (só placeholder). Só o QR tem fundo técnico branco.
  contentArea: { x: 0.5, y: 0.33, w: 0.42, h: 0.485, align: 'center' },
  safeArea: { x: 0.51, y: 0.34, w: 0.4, h: 0.465, align: 'center' },
  fields: {
    eyebrow: {
      x: 0.42, y: 0.14, w: 0.52, h: 0.05, align: 'center',
      typography: { family: SERIF, color: GOLD, sizePxAt300dpi: 54, weight: 600, letterSpacingPx: 12, uppercase: true },
    },
    title: {
      x: 0.42, y: 0.2, w: 0.52, h: 0.1, align: 'center',
      typography: { family: SERIF, color: INK, sizePxAt300dpi: 150, weight: 700 },
    },
    intro: {
      x: 0.51, y: 0.345, w: 0.4, h: 0.035, align: 'center',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 50 },
    },
    recipientName: {
      x: 0.505, y: 0.385, w: 0.41, h: 0.10, align: 'center',
      typography: { family: SERIF, color: GOLD_LIGHT, sizePxAt300dpi: 124, weight: 700 },
      minSizePxAt300dpi: 52,
      maxLines: 2,
    },
    body: {
      x: 0.52, y: 0.49, w: 0.38, h: 0.10, align: 'center',
      typography: { family: SERIF, color: INK, sizePxAt300dpi: 50 },
    },
    verificationCode: {
      x: 0.545, y: 0.664, w: 0.215, h: 0.032, align: 'left',
      typography: { family: MONO, color: GOLD, sizePxAt300dpi: 50, weight: 700, letterSpacingPx: 2 },
    },
    qrCaption: {
      x: 0.775, y: 0.78, w: 0.115, h: 0.028, align: 'center',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 30 },
    },
    issuedAt: {
      x: 0.545, y: 0.729, w: 0.215, h: 0.032, align: 'left',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 42 },
    },
    edition: {
      x: 0.51, y: 0.686, w: 0.27, h: 0.035, align: 'center',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 44, uppercase: true, letterSpacingPx: 4 },
    },
    verificationCodeLabel: {
      x: 0.545, y: 0.635, w: 0.215, h: 0.028, align: 'left',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 40 },
    },
    verificationCodeValue: {
      x: 0.545, y: 0.664, w: 0.215, h: 0.032, align: 'left',
      typography: { family: MONO, color: GOLD, sizePxAt300dpi: 52, weight: 700, letterSpacingPx: 2 },
    },
    issuedAtLabel: {
      x: 0.545, y: 0.70, w: 0.215, h: 0.028, align: 'left',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 40 },
    },
    issuedAtValue: {
      x: 0.545, y: 0.729, w: 0.215, h: 0.032, align: 'left',
      typography: { family: SERIF, color: INK, sizePxAt300dpi: 44 },
    },
  },
  // 5C.3.16.2 — QR desce para a grande área preta inferior direita
  // (x 0.775–0.89, y 0.625–0.775), completamente à DIREITA da assinatura
  // (assinatura: x < 0.68, y > 0.78 — sem toque/sobreposição). Lado
  // ≈ 370px @300dpi: leitura fiável por smartphone. Início y 0.625 fica
  // 0.035 abaixo do fim do corpo (0.59) — QR NUNCA ao lado/por cima do
  // texto principal. Só o QR tem fundo técnico branco.
  qr: { x: 0.775, y: 0.625, w: 0.115, h: 0.15, align: 'center', marginPx: 12 },
  margins: { top: 0.33, right: 0.07, bottom: 0.185, left: 0.5 },
  revokedWatermark: {
    text: 'REVOGADO',
    typography: { family: SANS, color: 'rgba(220,38,38,0.85)', sizePxAt300dpi: 220, weight: 800, letterSpacingPx: 18, uppercase: true },
    angleDeg: -18,
  },
};

const SEAL_FIELDS: SealTemplateConfig['fields'] = {
  brandLine: {
    x: 0.1, y: 0.62, w: 0.8, h: 0.07, align: 'center',
    typography: { family: SERIF, color: GOLD, sizePxAt300dpi: 44, weight: 700, uppercase: true, letterSpacingPx: 3 },
  },
  programLine: {
    x: 0.1, y: 0.69, w: 0.8, h: 0.06, align: 'center',
    typography: { family: SERIF, color: INK, sizePxAt300dpi: 36 },
  },
  yearLine: {
    x: 0.1, y: 0.75, w: 0.8, h: 0.06, align: 'center',
    typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 34, uppercase: true, letterSpacingPx: 2 },
  },
  distinctionLine: {
    x: 0.12, y: 0.81, w: 0.76, h: 0.06, align: 'center',
    typography: { family: SERIF, color: INK, sizePxAt300dpi: 30 },
    minSizePxAt300dpi: 20,
    maxLines: 2,
  },
};

const SEAL_CODE: SealTemplateConfig['verificationCode'] = {
  x: 0.1, y: 0.88, w: 0.8, h: 0.05, align: 'center',
  typography: { family: MONO, color: GOLD_LIGHT, sizePxAt300dpi: 26, weight: 700 },
};

const SEAL_REVOKED: SealTemplateConfig['revokedWatermark'] = {
  text: 'REVOGADO',
  typography: { family: SANS, color: 'rgba(220,38,38,0.9)', sizePxAt300dpi: 96, weight: 800, letterSpacingPx: 8, uppercase: true },
  angleDeg: -18,
};

/**
 * 5C.3.16 — VERSÃO 1 — SELO LIMPO.
 * Para website, redes sociais, publicidade e assinatura digital.
 * ARTE OFICIAL PURA: sem QR, sem texto sobreposto (o medalhão já contém
 * THE BEST EUROPA, louros, estrela e três estrelas). qrCaption = null.
 */
export const SEAL_CLEAN_TEMPLATE: SealTemplateConfig = {
  kind: 'seal',
  widthPx: 1080,
  heightPx: 1080,
  backgroundPath: CREDENTIAL_ASSETS.sealBackground,
  fallbackBackgroundPath: null,
  variant: 'clean',
  transparent: true,
  backgroundFit: 'contain',
  fields: SEAL_FIELDS,
  qr: null,
  verificationCode: SEAL_CODE,
  qrCaption: null,
  revokedWatermark: SEAL_REVOKED,
};

/**
 * 5C.3.16.1 — VERSÃO 2 — SELO VERIFICÁVEL (composição vertical transparente).
 * Mesma credencial, NADA cobre o medalhão: o medalhão oficial permanece
 * intacto e é apenas ligeiramente reduzido dentro do canvas (contain na
 * faixa superior) para libertar a faixa inferior transparente onde vivem
 * QR + "Verificar autenticidade" + código. QR fora do medalhão, com tamanho
 * suficiente para leitura por smartphone (≈210px em canvas 1080). Só o
 * próprio QR tem fundo técnico branco (contraste/leitura); o restante do
 * canvas continua transparente. Aparência premium, texto discreto, código
 * legível. Fundo sempre transparente.
 */
export const SEAL_VERIFIABLE_TEMPLATE: SealTemplateConfig = {
  kind: 'seal',
  widthPx: 1080,
  heightPx: 1080,
  backgroundPath: CREDENTIAL_ASSETS.sealBackground,
  fallbackBackgroundPath: null,
  variant: 'verifiable',
  transparent: true,
  backgroundFit: 'contain',
  fields: SEAL_FIELDS,
  // 5C.3.16.1 — faixa inferior transparente (y 0.75–0.97), FORA do
  // medalhão: QR à esquerda + textos discretos à direita, composição
  // vertical equilibrada [MEDALHÃO] / [QR + legenda + código].
  qr: { x: 0.235, y: 0.755, w: 0.195, h: 0.195, align: 'center', marginPx: 8 },
  verificationCode: {
    x: 0.455, y: 0.825, w: 0.36, h: 0.055, align: 'left',
    typography: { family: MONO, color: GOLD_LIGHT, sizePxAt300dpi: 30, weight: 700, letterSpacingPx: 1 },
  },
  qrCaption: {
    x: 0.455, y: 0.768, w: 0.36, h: 0.05, align: 'left',
    typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 26, uppercase: true, letterSpacingPx: 2 },
  },
  revokedWatermark: SEAL_REVOKED,
};

/** Template base (compat 5C.3.14): selo verificável por omissão. */
export const SEAL_TEMPLATE: SealTemplateConfig = SEAL_VERIFIABLE_TEMPLATE;

export const CREDENTIAL_TEMPLATES = {
  certificate: CERTIFICATE_TEMPLATE,
  seal: SEAL_TEMPLATE,
  sealClean: SEAL_CLEAN_TEMPLATE,
  sealVerifiable: SEAL_VERIFIABLE_TEMPLATE,
} as const;
