/**
 * THE BEST EUROPA — FASE 5C.3.15 — Configuração central dos templates visuais.
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
 * TEMPLATES SUBSTITUÍVEIS (sem alterar lógica eleitoral/credenciais/banco):
 *   /brand/credentials/certificate-background.png  (A4 landscape)
 *   /brand/credentials/seal-background.png         (medalhão, PNG c/ transparência)
 * Nesta fase os assets definitivos ainda NÃO existem fisicamente → o motor
 * usa placeholders técnicos claramente identificados (ver ASSET_PLACEHOLDER e
 * CREDENTIAL_ASSET_STATUS). Quando o proprietário colocar os ficheiros limpos
 * nos caminhos acima E marcar assetStatus: "official", o motor passa a
 * usá-los automaticamente, sem alterar código.
 *
 * NÃO reconstruir artisticamente as artes via CSS/SVG. NÃO criar imitação do
 * certificado. NÃO criar novo logótipo. NÃO modificar a identidade The Best
 * Europa. Placeholders técnicos continuam permitidos até os PNGs oficiais
 * limpos serem fornecidos.
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
 * 5C.3.15 — Estado explícito dos assets (fonte de verdade, sem rede).
 *
 * "placeholder" → PNG oficial AINDA NÃO instalado → renderer + preview usam
 *   fundo técnico provisório e mostram o aviso
 *   "Arte oficial ainda não instalada — utilizando placeholder técnico."
 * "official" → PNG oficial limpo instalado nos caminhos definitivos →
 *   aviso ocultado, arte oficial domina a composição.
 *
 * Para ativar a arte oficial: colocar os dois PNGs nos caminhos definitivos
 * e mudar ambos os flags para "official". Não é preciso alterar mais código.
 */
export const CREDENTIAL_ASSET_STATUS: Record<'certificate' | 'seal', CredentialAssetStatus> = {
  certificate: 'placeholder',
  seal: 'placeholder',
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
  // Arte oficial domina; dados dinâmicos ocupam a área preta à direita.
  contentArea: { x: 0.42, y: 0.1, w: 0.52, h: 0.8, align: 'center' },
  safeArea: { x: 0.43, y: 0.11, w: 0.5, h: 0.78, align: 'center' },
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
      x: 0.44, y: 0.33, w: 0.48, h: 0.05, align: 'center',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 52 },
    },
    recipientName: {
      x: 0.42, y: 0.38, w: 0.52, h: 0.09, align: 'center',
      typography: { family: SERIF, color: GOLD_LIGHT, sizePxAt300dpi: 110, weight: 700 },
      minSizePxAt300dpi: 56,
      maxLines: 2,
    },
    body: {
      x: 0.44, y: 0.49, w: 0.48, h: 0.16, align: 'center',
      typography: { family: SERIF, color: INK, sizePxAt300dpi: 50 },
    },
    verificationCode: {
      x: 0.44, y: 0.68, w: 0.48, h: 0.05, align: 'center',
      typography: { family: MONO, color: GOLD, sizePxAt300dpi: 52, weight: 700, letterSpacingPx: 2 },
    },
    qrCaption: {
      x: 0.74, y: 0.85, w: 0.24, h: 0.04, align: 'center',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 36 },
    },
    issuedAt: {
      x: 0.44, y: 0.73, w: 0.48, h: 0.05, align: 'center',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 44 },
    },
    edition: {
      x: 0.44, y: 0.78, w: 0.48, h: 0.05, align: 'center',
      typography: { family: SERIF, color: MUTED, sizePxAt300dpi: 44, uppercase: true, letterSpacingPx: 4 },
    },
  },
  // QR discreto na área inferior direita, sem sobrepor a arte.
  qr: { x: 0.8, y: 0.68, w: 0.12, h: 0.17, align: 'center', marginPx: 12 },
  margins: { top: 0.1, right: 0.06, bottom: 0.11, left: 0.42 },
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
 * 5C.3.15 — VERSÃO 1 — SELO LIMPO.
 * Para website, redes sociais, publicidade e assinatura digital.
 * Sem QR visível. Medalhão visualmente dominante, texto mínimo.
 */
export const SEAL_CLEAN_TEMPLATE: SealTemplateConfig = {
  kind: 'seal',
  widthPx: 1080,
  heightPx: 1080,
  backgroundPath: CREDENTIAL_ASSETS.sealBackground,
  fallbackBackgroundPath: null,
  variant: 'clean',
  transparent: true,
  fields: SEAL_FIELDS,
  qr: null,
  verificationCode: SEAL_CODE,
  revokedWatermark: SEAL_REVOKED,
};

/**
 * 5C.3.15 — VERSÃO 2 — SELO VERIFICÁVEL.
 * Mesma credencial, com QR/code discretos de autenticidade.
 * Não duplica credenciais: ambas derivam da MESMA digital_credential.
 */
export const SEAL_VERIFIABLE_TEMPLATE: SealTemplateConfig = {
  kind: 'seal',
  widthPx: 1080,
  heightPx: 1080,
  backgroundPath: CREDENTIAL_ASSETS.sealBackground,
  fallbackBackgroundPath: null,
  variant: 'verifiable',
  transparent: true,
  fields: SEAL_FIELDS,
  qr: { x: 0.78, y: 0.78, w: 0.16, h: 0.16, align: 'center', marginPx: 6 },
  verificationCode: SEAL_CODE,
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
