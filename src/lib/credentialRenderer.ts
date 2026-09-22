/**
 * THE BEST EUROPA — FASE 5C.3.14 — Motor de renderização visual.
 *
 * Geração client-side determinística: template + credential data → canvas →
 * PNG preview / PDF A4 landscape / PNG selo. NUNCA cria credencial nova,
 * NUNCA escreve em votes/vote_attempts/vote_adjustments/modality_votes,
 * NUNCA altera award/commercial/fulfillment/credential status, NUNCA usa
 * Storage remoto (sem bucket novo). QR contém SOMENTE a URL pública
 * /:programPrefix/verificar/:verificationCode (sem IDs internos).
 */
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import {
  CERTIFICATE_TEMPLATE,
  SEAL_TEMPLATE,
  type TemplateBox,
  type TemplateTypography,
} from '../config/credentialTemplates';
import {
  absoluteVerifyUrl,
  type CredentialDisplayData,
} from './credentialData';

export type RenderKind = 'certificate' | 'seal';

export interface TemplateAvailability {
  certificateBackground: boolean;
  sealBackground: boolean;
}

function boxToPx(box: TemplateBox, w: number, h: number) {
  return { x: box.x * w, y: box.y * h, w: box.w * w, h: box.h * h, align: box.align ?? 'center' as const };
}

function applyTypography(ctx: CanvasRenderingContext2D, t: TemplateTypography, scale: number) {
  const size = Math.max(1, Math.round(t.sizePxAt300dpi * scale));
  ctx.font = `${t.weight ?? 400} ${size}px ${t.family}`;
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'top';
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      t.letterSpacingPx ? `${Math.round(t.letterSpacingPx * scale)}px` : '0px';
  } catch { /* canvas sem letterSpacing — ignora */ }
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

/** Verifica se o asset oficial existe (HEAD/GET leve); false → placeholder. */
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
  let usedPlaceholder = false;
  if (bg) {
    ctx.drawImage(bg, 0, 0, w, h);
  } else {
    paintCertificatePlaceholder(ctx, w, h);
    usedPlaceholder = true;
  }
  const t = CERTIFICATE_TEMPLATE;
  drawWrapped(ctx, data.parentBrandName, t.fields.eyebrow, w, h, scale);
  drawWrapped(ctx, data.headline, t.fields.title, w, h, scale);
  drawWrapped(ctx, data.introLine, t.fields.intro, w, h, scale);
  drawWrapped(ctx, data.recipientName, t.fields.recipientName, w, h, scale, 1.15);
  drawWrapped(ctx, data.bodyText, t.fields.body, w, h, scale, 1.35);
  drawWrapped(ctx, data.codeLine, t.fields.verificationCode, w, h, scale);
  drawWrapped(ctx, data.issuedLine, t.fields.issuedAt, w, h, scale);
  drawWrapped(ctx, data.editionLine, t.fields.edition, w, h, scale);
  // QR verificável (URL absoluta).
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
    }
  }
  if (data.status === 'revoked') {
    drawRevokedStamp(ctx, CERTIFICATE_TEMPLATE.revokedWatermark.text, CERTIFICATE_TEMPLATE.revokedWatermark.typography, CERTIFICATE_TEMPLATE.revokedWatermark.angleDeg, w, h, scale);
  }
  return { canvas, usedPlaceholder };
}

export interface RenderSealOptions {
  backgroundImage?: HTMLImageElement | null;
}

/** Renderiza o selo digital 1080×1080 (PNG). */
export async function renderSealCanvas(
  data: CredentialDisplayData,
  options: RenderSealOptions = {},
): Promise<{ canvas: HTMLCanvasElement; usedPlaceholder: boolean }> {
  const w = SEAL_TEMPLATE.widthPx;
  const h = SEAL_TEMPLATE.heightPx;
  const scale = w / 1080;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  let bg = options.backgroundImage ?? null;
  if (bg === null && options.backgroundImage === undefined) {
    bg = await loadImage(SEAL_TEMPLATE.backgroundPath);
  }
  let usedPlaceholder = false;
  if (bg) {
    ctx.drawImage(bg, 0, 0, w, h);
  } else {
    paintSealPlaceholder(ctx, w, h);
    usedPlaceholder = true;
  }
  const f = SEAL_TEMPLATE.fields;
  drawWrapped(ctx, data.parentBrandName, f.brandLine, w, h, scale);
  drawWrapped(ctx, data.programName, f.programLine, w, h, scale);
  drawWrapped(
    ctx,
    data.campaignYear ? `Edição ${data.campaignYear}` : data.programName,
    f.yearLine,
    w,
    h,
    scale,
  );
  const distinctionShort = data.modalityName ?? data.distinctionLabel;
  drawWrapped(ctx, distinctionShort, f.distinctionLine, w, h, scale);
  drawWrapped(ctx, data.verificationCode, SEAL_TEMPLATE.verificationCode, w, h, scale);
  if (data.status === 'revoked') {
    drawRevokedStamp(ctx, SEAL_TEMPLATE.revokedWatermark.text, SEAL_TEMPLATE.revokedWatermark.typography, SEAL_TEMPLATE.revokedWatermark.angleDeg, w, h, scale);
  }
  return { canvas, usedPlaceholder };
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

export async function downloadSealPng(data: CredentialDisplayData, filename: string): Promise<void> {
  if (data.status === 'revoked') {
    throw new Error('Credencial revogada — download normal bloqueado.');
  }
  const { canvas } = await renderSealCanvas(data, {});
  await downloadCanvasPng(canvas, filename);
}
