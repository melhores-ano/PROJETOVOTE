/**
 * THE BEST EUROPA — FASE 5C.3.16.2 — Motor de renderização visual.
 *
 * Geração client-side determinística: template + credential data → canvas →
 * PNG preview / PDF A4 landscape / PNG selo (limpo ou verificável). NUNCA
 * cria credencial nova, NUNCA escreve em votes/vote_attempts/vote_adjustments/
 * modality_votes, NUNCA altera award/commercial/fulfillment/credential status,
 * NUNCA usa Storage remoto (sem bucket novo). QR contém SOMENTE a URL pública
 * /:programPrefix/verificar/:verificationCode (sem IDs internos — sem
 * business_id, distinction_id, credential UUID, tokens ou dados privados).
 *
  * 5C.3.16.2 — CORREÇÃO FINAL DO BLOCO DE AUTENTICAÇÃO (artes INTACTAS):
  *  - CERTIFICADO em duas zonas (referência aprovada = geometria só):
  *    ÁREA SUPERIOR/CENTRAL: intro + nome (auto-fit) + corpo (termina em
  *    y 0.59, ANTES da autenticação, line-height 1.5). eyebrow/title NÃO
  *    desenhados sobre a arte oficial (só placeholder). Cover SEM deformar
  *    (pequeno crop preferido a deformação).
  *    ÁREA INFERIOR DIREITA (à DIREITA da assinatura, assinatura isolada à
  *    esquerda/centro): bloco 4 linhas à esquerda do QR
  *    ("Código de verificação:" / valor / "Data de emissão:" / valor) +
  *    QR em coluna própria na grande área preta inferior direita
  *    (y 0.625–0.775, NUNCA ao lado/por cima do texto principal) +
  *    "Verificar autenticidade" imediatamente abaixo do QR. Margem visual
  *    clara corpo→autenticação. QR ≈370px @300dpi (leitura smartphone).
  *    Edition NÃO desenhada sobre a arte oficial (só placeholder).
 *  - SELO LIMPO: INTACTO — arte pura, sem QR, sem código, sem legenda,
 *    sem fundo branco, contain, transparência original.
 *  - SELO VERIFICÁVEL: composição vertical transparente — medalhão oficial
 *    INTACTO e ligeiramente reduzido dentro do canvas (contain na faixa
 *    superior) para libertar a faixa inferior; QR + "Verificar
 *    autenticidade" + código FORA do medalhão, em baixo. Canvas sempre
 *    transparente; só o próprio QR tem fundo técnico branco
 *    (contraste/leitura); nada cobre o selo.
 *  - Fail-safe preservado: sem PNG oficial, o placeholder técnico continua.
 *  - fonte de verdade do asset = CREDENTIAL_ASSET_STATUS (sem rede).
 */
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import {
  CERTIFICATE_TEMPLATE,
  CREDENTIAL_COPY,
  SEAL_CLEAN_TEMPLATE,
  SEAL_TEMPLATE,
  SEAL_VERIFIABLE_TEMPLATE,
  isOfficialAsset,
  type SealTemplateConfig,
  type SealVariant,
  type TemplateBox,
  type TemplateTypography,
} from '../config/credentialTemplates';
import {
  absoluteVerifyUrl,
  sealDistinctionShort,
  sealYearLine,
  type CredentialDisplayData,
} from './credentialData';

export type RenderKind = 'certificate' | 'seal';
export type { SealVariant };

export interface TemplateAvailability {
  certificateBackground: boolean;
  sealBackground: boolean;
}

function boxToPx(box: TemplateBox, w: number, h: number) {
  return { x: box.x * w, y: box.y * h, w: box.w * w, h: box.h * h, align: box.align ?? 'center' as const };
}

function applyTypography(ctx: CanvasRenderingContext2D, t: TemplateTypography, scale: number, overrideSizePx?: number) {
  const size = Math.max(1, Math.round((overrideSizePx ?? t.sizePxAt300dpi) * scale));
  ctx.font = `${t.weight ?? 400} ${size}px ${t.family}`;
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'top';
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      t.letterSpacingPx ? `${Math.round(t.letterSpacingPx * scale)}px` : '0px';
  } catch { /* canvas sem letterSpacing — ignora */ }
  return size;
}

function displayText(text: string, uppercase?: boolean): string {
  return uppercase ? text.toUpperCase() : text;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const probe = current === '' ? word : `${current} ${word}`;
    if (ctx.measureText(probe).width <= maxWidth || current === '') {
      current = probe;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: TemplateBox & { typography: TemplateTypography },
  canvasW: number,
  canvasH: number,
  scale: number,
  lineHeightRatio = 1.25,
): void {
  const px = boxToPx(box, canvasW, canvasH);
  applyTypography(ctx, box.typography, scale);
  const content = displayText(text, box.typography.uppercase);
  const lines = wrapLines(ctx, content, px.w);
  const size = Math.max(1, Math.round(box.typography.sizePxAt300dpi * scale));
  const lineHeight = size * lineHeightRatio;
  const totalH = lines.length * lineHeight;
  let startY = px.y;
  if (box.align === 'center') startY = px.y + Math.max(0, (px.h - totalH) / 2);
  if (box.align === 'right') startY = px.y + Math.max(0, px.h - totalH);
  ctx.textAlign = box.align ?? 'center';
  const cx = box.align === 'left' ? px.x : box.align === 'right' ? px.x + px.w : px.x + px.w / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, startY + i * lineHeight, px.w);
  });
  ctx.textAlign = 'left';
}

/**
 * 5C.3.15 — Desenha com redução automática de font-size para nomes longos:
 * reduz até caber em maxLines dentro da largura da caixa (nunca abaixo de
 * minSize). Garante acentos PT (fontes serif do projeto) e nunca deixa o
 * nome sair da área útil (wrap controlado + maxWidth no fillText).
 */
function drawAutoFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: TemplateBox & { typography: TemplateTypography; minSizePxAt300dpi: number; maxLines: number },
  canvasW: number,
  canvasH: number,
  scale: number,
  lineHeightRatio = 1.15,
): void {
  const px = boxToPx(box, canvasW, canvasH);
  const content = displayText(text, box.typography.uppercase);
  let sizePx = box.typography.sizePxAt300dpi;
  let lines: string[] = [content];
  while (sizePx > box.minSizePxAt300dpi) {
    applyTypography(ctx, box.typography, scale, sizePx);
    lines = wrapLines(ctx, content, px.w);
    if (lines.length <= box.maxLines) break;
    sizePx -= 4;
  }
  applyTypography(ctx, box.typography, scale, sizePx);
  lines = wrapLines(ctx, content, px.w).slice(0, box.maxLines);
  const size = Math.max(1, Math.round(sizePx * scale));
  const lineHeight = size * lineHeightRatio;
  const totalH = lines.length * lineHeight;
  let startY = px.y;
  if (box.align === 'center') startY = px.y + Math.max(0, (px.h - totalH) / 2);
  if (box.align === 'right') startY = px.y + Math.max(0, px.h - totalH);
  ctx.textAlign = box.align ?? 'center';
  const cx = box.align === 'left' ? px.x : box.align === 'right' ? px.x + px.w : px.x + px.w / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, startY + i * lineHeight, px.w);
  });
  ctx.textAlign = 'left';
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 8000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * 5C.3.16 — Desenha a arte oficial em COVER: preenche todo o canvas A4
 * landscape SEM deformar (crop centrado do excedente). A arte oficial
 * (1754×1241) é praticamente A4 landscape: crop negligenciável nas
 * extremidades. Crop é sempre preferido a deformação.
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * 5C.3.16 — Desenha a arte oficial em CONTAIN: cabe inteira no canvas,
 * centrada, SEM deformar e SEM preencher fundo (o canvas do selo mantém
 * transparência exterior — nunca fundo branco).
 */
function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
): void {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * 5C.3.16.1 — Desenha a arte oficial em CONTAIN dentro de um retângulo
 * arbitrário (para o selo verificável: medalhão ligeiramente reduzido na
 * faixa superior, libertando a faixa inferior para QR/código/legenda —
 * NADA é desenhado POR CIMA do medalhão). Preserva proporção e
 * transparência exterior — nunca fundo branco.
 */
function drawImageContainInRect(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): void {
  const scale = Math.min(rw / img.width, rh / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, rx + (rw - dw) / 2, ry + (rh - dh) / 2, dw, dh);
}

/**
 * Verifica se o asset oficial existe (HEAD/GET leve); false → placeholder.
 * NOTA 5C.3.15: a fonte de verdade visível é CREDENTIAL_ASSET_STATUS
 * (configuração explícita, sem rede). Esta sonda é apenas fallback técnico
 * para o carregamento da imagem — o aviso "Arte oficial ainda não instalada"
 * deriva do flag, não desta função.
 */
export async function checkTemplateAvailability(): Promise<TemplateAvailability> {
  async function probe(path: string): Promise<boolean> {
    try {
      const res = await fetch(path, { method: 'HEAD' });
      if (res.ok) return true;
    } catch { /* segue para GET */ }
    try {
      const res = await fetch(path, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      return res.ok;
    } catch {
      return false;
    }
  }
  const [certificateBackground, sealBackground] = await Promise.all([
    probe(CERTIFICATE_TEMPLATE.backgroundPath),
    probe(SEAL_TEMPLATE.backgroundPath),
  ]);
  return { certificateBackground, sealBackground };
}

/** Estado oficial vs placeholder por configuração explícita (sem rede). */
export function templateAssetStatus(): { certificate: 'placeholder' | 'official'; seal: 'placeholder' | 'official' } {
  return {
    certificate: isOfficialAsset('certificate') ? 'official' : 'placeholder',
    seal: isOfficialAsset('seal') ? 'official' : 'placeholder',
  };
}

function paintCertificatePlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#0a0a0c');
  g.addColorStop(0.42, '#101014');
  g.addColorStop(1, '#16161c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Estrela dourada estilizada (placeholder geométrico, não arte final).
  ctx.save();
  ctx.translate(w * 0.2, h * 0.5);
  ctx.strokeStyle = 'rgba(200,162,75,0.55)';
  ctx.lineWidth = Math.max(2, w * 0.0012);
  const R = Math.min(w, h) * 0.34;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? R : R * 0.42;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  // Linhas laterais decorativas.
  ctx.fillStyle = 'rgba(200,162,75,0.35)';
  ctx.fillRect(w * 0.012, h * 0.08, Math.max(2, w * 0.0015), h * 0.84);
  ctx.fillRect(w * 0.985, h * 0.08, Math.max(2, w * 0.0015), h * 0.84);
  // Aviso técnico de placeholder.
  ctx.fillStyle = 'rgba(185,178,160,0.9)';
  ctx.font = `${Math.round(h * 0.022)}px Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('FUNDO TÉCNICO PROVISÓRIO — colocar certificate-background.png em /brand/credentials/', w * 0.03, h * 0.96);
  ctx.textAlign = 'left';
}

function paintSealPlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.46;
  const ring = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  ring.addColorStop(0, '#0d1512');
  ring.addColorStop(0.72, '#101a15');
  ring.addColorStop(0.86, '#8a6d2f');
  ring.addColorStop(1, '#c8a24b');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d1512';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c8a24b';
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  // Estrela central provisória.
  ctx.save();
  ctx.translate(cx, cy - R * 0.18);
  ctx.fillStyle = '#c8a24b';
  ctx.beginPath();
  const SR = R * 0.16;
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? SR : SR * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRevokedStamp(
  ctx: CanvasRenderingContext2D,
  text: string,
  t: TemplateTypography,
  angleDeg: number,
  canvasW: number,
  canvasH: number,
  scale: number,
): void {
  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  applyTypography(ctx, t, scale);
  ctx.textAlign = 'center';
  ctx.strokeStyle = t.color;
  ctx.lineWidth = Math.max(2, 6 * scale);
  const label = displayText(text, t.uppercase);
  const tw = ctx.measureText(label).width;
  ctx.strokeRect(-tw / 2 - 40 * scale, -70 * scale, tw + 80 * scale, 170 * scale);
  ctx.fillText(label, 0, -40 * scale);
  ctx.restore();
  ctx.textAlign = 'left';
}

/** QR dataURL da URL pública absoluta (sem IDs internos). */
export async function buildVerifyQrDataUrl(absoluteUrl: string, sizePx = 512): Promise<string> {
  return QRCode.toDataURL(absoluteUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: sizePx,
    color: { dark: '#0b0b0d', light: '#ffffff' },
  });
}

function originNow(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

function sealTemplateFor(variant: SealVariant): SealTemplateConfig {
  return variant === 'clean' ? SEAL_CLEAN_TEMPLATE : SEAL_VERIFIABLE_TEMPLATE;
}

export interface RenderCertificateOptions {
  /** Escala de preview (1 = 300dpi). Usa 0.35 para preview rápido. */
  scale?: number;
  backgroundImage?: HTMLImageElement | null;
  qrDataUrl?: string | null;
}

/** Renderiza o certificado A4 landscape num canvas (placeholder se sem asset). */
export async function renderCertificateCanvas(
  data: CredentialDisplayData,
  options: RenderCertificateOptions = {},
): Promise<{ canvas: HTMLCanvasElement; usedPlaceholder: boolean }> {
  const scale = options.scale ?? 1;
  const w = Math.round(CERTIFICATE_TEMPLATE.widthPx * scale);
  const h = Math.round(CERTIFICATE_TEMPLATE.heightPx * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  let bg = options.backgroundImage ?? null;
  if (bg === null && options.backgroundImage === undefined) {
    bg = await loadImage(CERTIFICATE_TEMPLATE.backgroundPath);
  }
  const official = isOfficialAsset('certificate');
  let usedPlaceholder = false;
  if (bg) {
    // 5C.3.16 — arte oficial em cover (sem deformação); fail-safe continua.
    if (official) drawImageCover(ctx, bg, w, h);
    else ctx.drawImage(bg, 0, 0, w, h);
  } else {
    paintCertificatePlaceholder(ctx, w, h);
    usedPlaceholder = true;
  }
  // Sem configuração oficial instalada, o placeholder técnico continua
  // identificado mesmo que um PNG transitório exista em cache.
  if (!official) usedPlaceholder = true;
  const t = CERTIFICATE_TEMPLATE;
  // 5C.3.16.2 — a ARTE OFICIAL já contém estrela, medalhão, título
  // "Certificado", assinatura e decoração: eyebrow/title servem SÓ o
  // placeholder e NUNCA vão sobre a arte real. Composição em duas zonas:
  //   SUPERIOR/CENTRAL: intro + nome (auto-fit preservado) + corpo que
  //   TERMINA em y 0.59, ANTES da autenticação (margem visual clara).
  //   INFERIOR DIREITA (à DIREITA da assinatura): bloco 4 linhas à
  //   esquerda do QR + QR na grande área preta inferior direita +
  //   "Verificar autenticidade" imediatamente abaixo do QR. Assinatura
  //   (esquerda/centro) permanece isolada — nada a toca/sobrepõe.
  // Edition NÃO vai sobre a arte oficial (só placeholder).
  if (!official) {
    drawWrapped(ctx, data.parentBrandName, t.fields.eyebrow, w, h, scale);
    drawWrapped(ctx, data.headline, t.fields.title, w, h, scale);
  }
  // ÁREA SUPERIOR/CENTRAL — texto principal (termina ANTES da autenticação).
  drawWrapped(ctx, data.introLine, t.fields.intro, w, h, scale, 1.4);
  drawAutoFit(ctx, data.recipientName, t.fields.recipientName, w, h, scale, 1.12);
  drawWrapped(ctx, data.bodyText, t.fields.body, w, h, scale, 1.5);
  if (official) {
    // ÁREA INFERIOR DIREITA — bloco 4 linhas à esquerda do QR.
    drawWrapped(ctx, data.verificationCodeLabel, t.fields.verificationCodeLabel, w, h, scale, 1.3);
    drawWrapped(ctx, data.verificationCodeValue, t.fields.verificationCodeValue, w, h, scale, 1.3);
    drawWrapped(ctx, data.issuedAtLabel, t.fields.issuedAtLabel, w, h, scale, 1.3);
    drawWrapped(ctx, data.issuedAtValue, t.fields.issuedAtValue, w, h, scale, 1.3);
  } else {
    drawWrapped(ctx, data.codeLine, t.fields.verificationCode, w, h, scale, 1.3);
    drawWrapped(ctx, data.issuedLine, t.fields.issuedAt, w, h, scale, 1.3);
    drawWrapped(ctx, data.editionLine, t.fields.edition, w, h, scale);
  }
  // QR verificável (URL pública absoluta, sem IDs internos) — desce para
  // a grande área preta inferior direita (y 0.625–0.775), coluna própria à
  // direita da assinatura, NUNCA ao lado/por cima do texto principal.
  // Legenda "Verificar autenticidade" imediatamente abaixo do QR.
  const absoluteUrl = absoluteVerifyUrl(originNow(), data.verifyPath);
  let qrUrl = options.qrDataUrl ?? null;
  if (qrUrl === null && options.qrDataUrl === undefined) {
    qrUrl = await buildVerifyQrDataUrl(absoluteUrl, 512);
  }
  if (qrUrl) {
    const img = await loadImage(qrUrl);
    if (img) {
      const q = boxToPx(t.qr, w, h);
      const side = Math.min(q.w, q.h);
      const qx = q.x + (q.w - side) / 2;
      const qy = q.y + (q.h - side) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qx - t.qr.marginPx * scale, qy - t.qr.marginPx * scale, side + t.qr.marginPx * 2 * scale, side + t.qr.marginPx * 2 * scale);
      ctx.drawImage(img, qx, qy, side, side);
      drawWrapped(ctx, CREDENTIAL_COPY.qrCaption, t.fields.qrCaption, w, h, scale);
    }
  }
  if (data.status === 'revoked') {
    drawRevokedStamp(ctx, CERTIFICATE_TEMPLATE.revokedWatermark.text, CERTIFICATE_TEMPLATE.revokedWatermark.typography, CERTIFICATE_TEMPLATE.revokedWatermark.angleDeg, w, h, scale);
  }
  return { canvas, usedPlaceholder };
}

export interface RenderSealOptions {
  backgroundImage?: HTMLImageElement | null;
  qrDataUrl?: string | null;
  /**
   * 5C.3.15 — variante do selo:
   *  - "clean": sem QR visível (website/redes/publicidade/assinatura);
   *  - "verifiable": QR + código discretos (autenticidade).
   * Omisso → "verifiable" (compat 5C.3.14, que já expunha o código).
   */
  variant?: SealVariant;
}

function sealTexts(data: CredentialDisplayData) {
  return {
    year: sealYearLine(data.campaignYear, data.programName),
    distinction: sealDistinctionShort({ modalityName: data.modalityName, categoryName: data.distinctionLabel }),
  };
}

/**
 * Renderiza o selo digital 1080×1080 (PNG com transparência preservada —
 * nunca fundo branco). O medalhão permanece visualmente dominante; texto
 * mínimo (ano + modalidade/categoria quando apropriado).
 *
 * 5C.3.16.1 — selo limpo oficial = arte pura INTACTA (contain integral).
 * Selo verificável oficial = composição vertical transparente:
 * [MEDALHÃO OFICIAL INTACTO, ligeiramente reduzido na faixa superior]
 * [QR + "Verificar autenticidade" + código FORA do medalhão, em baixo].
 * NADA é colocado POR CIMA do medalhão.
 */
export async function renderSealCanvas(
  data: CredentialDisplayData,
  options: RenderSealOptions = {},
): Promise<{ canvas: HTMLCanvasElement; usedPlaceholder: boolean; variant: SealVariant }> {
  const variant: SealVariant = options.variant ?? 'verifiable';
  const tpl = sealTemplateFor(variant);
  const w = tpl.widthPx;
  const h = tpl.heightPx;
  const scale = w / 1080;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  let bg = options.backgroundImage ?? null;
  if (bg === null && options.backgroundImage === undefined) {
    bg = await loadImage(tpl.backgroundPath);
  }
  const official = isOfficialAsset('seal');
  let usedPlaceholder = false;
  if (bg) {
    // 5C.3.16 — arte oficial em contain sobre canvas transparente
    // (proporção + transparência preservadas, nunca fundo branco).
    if (official) {
      ctx.clearRect(0, 0, w, h);
      drawImageContain(ctx, bg, w, h);
    } else {
      ctx.drawImage(bg, 0, 0, w, h);
    }
  } else {
    paintSealPlaceholder(ctx, w, h);
    usedPlaceholder = true;
  }
  if (!official) usedPlaceholder = true;
  // 5C.3.16.1 — ARTE OFICIAL: o medalhão já contém THE BEST EUROPA,
  // louros, estrela e três estrelas → NENHUM QR ou texto POR CIMA do
  // medalhão. Selo limpo oficial = arte pura INTACTA. Selo verificável
  // oficial = composição vertical transparente (medalhão intacto em cima,
  // ligeiramente reduzido para libertar a faixa inferior + QR/código/
  // micro-legenda FORA do medalhão, em baixo). O caminho placeholder
  // (fail-safe) mantém o overlay textual anterior.
  if (official && !usedPlaceholder) {
    // Selo limpo oficial = arte pura (sem texto, sem QR, sem código,
    // sem legenda, sem fundo branco, contain, transparência original).
    if (variant === 'clean') {
      if (data.status === 'revoked') {
        drawRevokedStamp(ctx, tpl.revokedWatermark.text, tpl.revokedWatermark.typography, tpl.revokedWatermark.angleDeg, w, h, scale);
      }
      return { canvas, usedPlaceholder, variant };
    }
    // Selo verificável oficial: recompõe sem cobrir o medalhão.
    // 1) Limpa o desenho integral e redesenha o medalhão INTACTO na
    //    faixa superior (contain em 0 → 74% da altura).
    if (bg && tpl.qr) {
      ctx.clearRect(0, 0, w, h);
      drawImageContainInRect(ctx, bg, 0, 0, w, h * 0.74);
    }
    // 2) Micro-legenda + código seguem na faixa inferior transparente,
    //    ao lado do QR (fora do medalhão). QR com fundo técnico branco
    //    SÓ à volta do próprio QR (contraste/leitura por smartphone).
  } else {
    const f = tpl.fields;
    const texts = sealTexts(data);
    drawWrapped(ctx, data.parentBrandName, f.brandLine, w, h, scale);
    drawWrapped(ctx, data.programName, f.programLine, w, h, scale);
    drawWrapped(ctx, texts.year, f.yearLine, w, h, scale);
    drawAutoFit(ctx, texts.distinction, f.distinctionLine, w, h, scale);
    if (variant === 'clean') {
      if (data.status === 'revoked') {
        drawRevokedStamp(ctx, tpl.revokedWatermark.text, tpl.revokedWatermark.typography, tpl.revokedWatermark.angleDeg, w, h, scale);
      }
      return { canvas, usedPlaceholder, variant };
    }
    drawWrapped(ctx, data.verificationCode, tpl.verificationCode, w, h, scale);
    if (data.status === 'revoked') {
      drawRevokedStamp(ctx, tpl.revokedWatermark.text, tpl.revokedWatermark.typography, tpl.revokedWatermark.angleDeg, w, h, scale);
    }
    return { canvas, usedPlaceholder, variant };
  }
  // VERSÃO 1 (clean): sem QR visível — tratado acima (arte pura).
  // VERSÃO 2 (verifiable): composição vertical — QR FORA do medalhão,
  // na faixa inferior transparente, com tamanho para leitura por
  // smartphone; só o QR tem fundo técnico branco; textos discretos ao
  // lado; nada cobre o selo.
  if (variant === 'verifiable' && tpl.qr) {
    const absoluteUrl = absoluteVerifyUrl(originNow(), data.verifyPath);
    let qrUrl = options.qrDataUrl ?? null;
    if (qrUrl === null && options.qrDataUrl === undefined) {
      qrUrl = await buildVerifyQrDataUrl(absoluteUrl, 320);
    }
    if (qrUrl) {
      const img = await loadImage(qrUrl);
      if (img) {
        const q = boxToPx(tpl.qr, w, h);
        const side = Math.min(q.w, q.h);
        const qx = q.x + (q.w - side) / 2;
        const qy = q.y + (q.h - side) / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(qx - tpl.qr.marginPx, qy - tpl.qr.marginPx, side + tpl.qr.marginPx * 2, side + tpl.qr.marginPx * 2);
        ctx.drawImage(img, qx, qy, side, side);
      }
    }
  }
  if (tpl.qrCaption) {
    drawWrapped(ctx, CREDENTIAL_COPY.qrCaption, tpl.qrCaption, w, h, scale, 1.3);
  }
  drawWrapped(ctx, data.verificationCode, tpl.verificationCode, w, h, scale, 1.25);
  if (data.status === 'revoked') {
    drawRevokedStamp(ctx, tpl.revokedWatermark.text, tpl.revokedWatermark.typography, tpl.revokedWatermark.angleDeg, w, h, scale);
  }
  return { canvas, usedPlaceholder, variant };
}

/** 5C.3.15 — selo limpo (sem QR): website, redes, publicidade, assinatura. */
export async function renderSealCleanCanvas(
  data: CredentialDisplayData,
  options: Omit<RenderSealOptions, 'variant'> = {},
): Promise<{ canvas: HTMLCanvasElement; usedPlaceholder: boolean; variant: SealVariant }> {
  return renderSealCanvas(data, { ...options, variant: 'clean' });
}

/** 5C.3.15 — selo verificável (QR discreto + código). Mesma credencial. */
export async function renderSealVerifiableCanvas(
  data: CredentialDisplayData,
  options: Omit<RenderSealOptions, 'variant'> = {},
): Promise<{ canvas: HTMLCanvasElement; usedPlaceholder: boolean; variant: SealVariant }> {
  return renderSealCanvas(data, { ...options, variant: 'verifiable' });
}

/** Descarrega o certificado em PDF A4 landscape (alta resolução). */
export async function downloadCertificatePdf(data: CredentialDisplayData, filename: string): Promise<void> {
  if (data.status === 'revoked') {
    throw new Error('Credencial revogada — geração normal bloqueada. O preview apresenta o carimbo REVOGADO.');
  }
  const { canvas } = await renderCertificateCanvas(data, { scale: 1 });
  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);
  pdf.save(filename);
}

/** Descarrega PNG (certificado preview HD ou selo). */
export async function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  if (!blob) throw new Error('Falha ao gerar o PNG.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadCertificatePng(data: CredentialDisplayData, filename: string): Promise<void> {
  if (data.status === 'revoked') {
    throw new Error('Credencial revogada — download normal bloqueado.');
  }
  const { canvas } = await renderCertificateCanvas(data, { scale: 0.5 });
  await downloadCanvasPng(canvas, filename);
}

export async function downloadSealPng(
  data: CredentialDisplayData,
  filename: string,
  variant: SealVariant = 'verifiable',
): Promise<void> {
  if (data.status === 'revoked') {
    throw new Error('Credencial revogada — download normal bloqueado.');
  }
  const { canvas } = await renderSealCanvas(data, { variant });
  await downloadCanvasPng(canvas, filename);
}
