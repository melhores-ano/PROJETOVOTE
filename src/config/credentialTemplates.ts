/**
 * THE BEST EUROPA — FASE 5C.3.14 — Configuração central dos templates visuais.
 *
 * ÚNICA fonte de verdade visual para certificados e selos:
 *   credentialTemplates.ts → configuração
 *   credentialRenderer.ts  → renderização
 *   CredentialPreview      → visualização
 *   DistinctionsAdminPage  → ações operacionais
 *
 * Nenhum número mágico fora deste ficheiro: dimensões, coordenadas (0–1
 * normalizadas), tipografia, tamanhos, posições de QR e código.
 *
 * TEMPLATES SUBSTITUÍVEIS (sem alterar lógica eleitoral/credenciais/banco):
 *   /brand/credentials/certificate-background.png  (A4 landscape)
 *   /brand/credentials/seal-background.png         (medalhão, PNG c/ transparência)
 * Nesta fase os assets definitivos ainda NÃO existem fisicamente → o motor
 * usa placeholders técnicos claramente identificados (ver ASSET_PLACEHOLDER).
 * Quando o proprietário colocar os ficheiros limpos nos caminhos acima, o
 * motor passa a usá-los automaticamente, sem alterar código.
 *
 * PT-PT. Sem votos, sem ranking, sem pagamentos, sem 2027, sem novo país.
 */

export type CredentialTemplateKind = 'certificate' | 'seal';

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
  contentArea: TemplateBox;
  fields: {
    eyebrow: TemplateBox & { typography: TemplateTypography };
    title: TemplateBox & { typography: TemplateTypography };
    intro: TemplateBox & { typography: TemplateTypography };
    recipientName: TemplateBox & { typography: TemplateTypography };
    body: TemplateBox & { typography: TemplateTypography };
    verificationCode: TemplateBox & { typography: TemplateTypography };
    issuedAt: TemplateBox & { typography: TemplateTypography };
    edition: TemplateBox & { typography: TemplateTypography };
  };
  qr: TemplateBox & { marginPx: number };
  revokedWatermark: { text: string; typography: TemplateTypography; angleDeg: number };
}

export interface SealTemplateConfig {
  kind: 'seal';
  /** 1080 × 1080 para web/redes/assinatura. */
  widthPx: number;
  heightPx: number;
  backgroundPath: string;
  fallbackBackgroundPath: string | null;
  fields: {
    brandLine: TemplateBox & { typography: TemplateTypography };
    programLine: TemplateBox & { typography: TemplateTypography };
    yearLine: TemplateBox & { typography: TemplateTypography };
    distinctionLine: TemplateBox & { typography: TemplateTypography };
  };
  qr: TemplateBox | null;
  verificationCode: TemplateBox & { typography: TemplateTypography };
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

const GOLD = '#C8A24B';
const GOLD_LIGHT = '#E8C97A';
const INK = '#F5EFE0';
const MUTED = '#B9B2A0';

export const CERTIFICATE_TEMPLATE: CertificateTemplateConfig = {
  kind: 'certificate',
  widthPx: 3508,
  heightPx: 2480,
  format: 'A4',
  orientation: 'landscape',
  backgroundPath: CREDENTIAL_ASSETS.certificateBackground,
  fallbackBackgroundPath: null,
  contentArea: { x: 0.42, y: 0.1, w: 0.52, h: 0.8, align: 'center' },
  fields: {
    eyebrow: {
      x: 0.42, y: 0.14, w: 0.52, h: 0.05, align: 'center',
      typography: { family: 'Georgia, "Times New Roman", serif', color: GOLD, sizePxAt300dpi: 54, weight: 600, letterSpacingPx: 12, uppercase: true },
    },
    title: {
      x: 0.42, y: 0.2, w: 0.52, h: 0.1, align: 'center',
      typography: { family: 'Georgia, "Times New Roman", serif', color: INK, sizePxAt300dpi: 150, weight: 700 },
    },
    intro: {
      x: 0.44, y: 0.33, w: 0.48, h: 0.05, align: 'center',
      typography: { family: 'Georgia, serif', color: MUTED, sizePxAt300dpi: 52 },
    },
    recipientName: {
      x: 0.42, y: 0.38, w: 0.52, h: 0.09, align: 'center',
      typography: { family: 'Georgia, "Times New Roman", serif', color: GOLD_LIGHT, sizePxAt300dpi: 110, weight: 700 },
    },
    body: {
      x: 0.44, y: 0.49, w: 0.48, h: 0.16, align: 'center',
      typography: { family: 'Georgia, serif', color: INK, sizePxAt300dpi: 50 },
    },
    verificationCode: {
      x: 0.44, y: 0.68, w: 0.48, h: 0.05, align: 'center',
      typography: { family: '"Courier New", monospace', color: GOLD, sizePxAt300dpi: 52, weight: 700, letterSpacingPx: 2 },
    },
    issuedAt: {
      x: 0.44, y: 0.73, w: 0.48, h: 0.05, align: 'center',
      typography: { family: 'Georgia, serif', color: MUTED, sizePxAt300dpi: 44 },
    },
    edition: {
      x: 0.44, y: 0.78, w: 0.48, h: 0.05, align: 'center',
      typography: { family: 'Georgia, serif', color: MUTED, sizePxAt300dpi: 44, uppercase: true, letterSpacingPx: 4 },
    },
  },
  qr: { x: 0.8, y: 0.68, w: 0.12, h: 0.17, align: 'center', marginPx: 12 },
  revokedWatermark: {
    text: 'REVOGADO',
    typography: { family: 'Arial, sans-serif', color: 'rgba(220,38,38,0.85)', sizePxAt300dpi: 220, weight: 800, letterSpacingPx: 18, uppercase: true },
    angleDeg: -18,
  },
};

export const SEAL_TEMPLATE: SealTemplateConfig = {
  kind: 'seal',
  widthPx: 1080,
  heightPx: 1080,
  backgroundPath: CREDENTIAL_ASSETS.sealBackground,
  fallbackBackgroundPath: null,
  fields: {
    brandLine: {
      x: 0.1, y: 0.62, w: 0.8, h: 0.07, align: 'center',
      typography: { family: 'Georgia, serif', color: GOLD, sizePxAt300dpi: 44, weight: 700, uppercase: true, letterSpacingPx: 3 },
    },
    programLine: {
      x: 0.1, y: 0.69, w: 0.8, h: 0.06, align: 'center',
      typography: { family: 'Georgia, serif', color: INK, sizePxAt300dpi: 36 },
    },
    yearLine: {
      x: 0.1, y: 0.75, w: 0.8, h: 0.06, align: 'center',
      typography: { family: 'Georgia, serif', color: MUTED, sizePxAt300dpi: 34, uppercase: true, letterSpacingPx: 2 },
    },
    distinctionLine: {
      x: 0.12, y: 0.81, w: 0.76, h: 0.06, align: 'center',
      typography: { family: 'Georgia, serif', color: INK, sizePxAt300dpi: 30 },
    },
  },
  qr: null,
  verificationCode: {
    x: 0.1, y: 0.88, w: 0.8, h: 0.05, align: 'center',
    typography: { family: '"Courier New", monospace', color: GOLD_LIGHT, sizePxAt300dpi: 26, weight: 700 },
  },
  revokedWatermark: {
    text: 'REVOGADO',
    typography: { family: 'Arial, sans-serif', color: 'rgba(220,38,38,0.9)', sizePxAt300dpi: 96, weight: 800, letterSpacingPx: 8, uppercase: true },
    angleDeg: -18,
  },
};

export const CREDENTIAL_TEMPLATES = {
  certificate: CERTIFICATE_TEMPLATE,
  seal: SEAL_TEMPLATE,
} as const;
