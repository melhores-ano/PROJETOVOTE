/**
 * THE BEST EUROPA — FASE 5C.3.15 — Dados do certificado/selo.
 *
 * Resolve DINAMICAMENTE a partir da digital_credential já emitida +
 * distinção/fonte autorizada. NUNCA cria credencial, NUNCA copia votos,
 * NUNCA persiste ranking como verdade permanente.
 *
 * Texto PT-PT premium e curto (sem texto antigo de terceiros, sem
 * "gerando empregos...", sem referências ao município do certificado ASTEC).
 * Nomes longos são protegidos no renderer (redução automática + wrap);
 * aqui garantimos normalização e limites sanos sem cortar identidade.
 */
import type { DigitalCredential } from '../types/database';
import { verificationUrl } from './digitalCredentials';

export interface CredentialSubject {
  businessName: string;
  parentBrandName: string;
  programName: string;
  campaignYear: number | null;
  campaignName: string | null;
  cityName: string;
  categoryName: string;
  modalityName: string | null;
  distinctionLabel: string;
}

export interface CredentialDisplayData extends CredentialSubject {
  credentialType: 'certificate' | 'digital_seal';
  verificationCode: string;
  issuedAt: string;
  issuedAtFormatted: string;
  status: 'issued' | 'revoked';
  programPrefix: string;
  verifyPath: string;
  headline: string;
  introLine: string;
  recipientName: string;
  bodyText: string;
  codeLine: string;
  issuedLine: string;
  editionLine: string;
}

export interface ResolveCredentialDataInput {
  credential: Pick<DigitalCredential, 'credential_type' | 'verification_code' | 'issued_at' | 'status'>;
  distinctionLabel?: string | null;
  businessName?: string | null;
  parentBrandName?: string;
  programName?: string | null;
  campaignYear?: number | null;
  campaignName?: string | null;
  cityName?: string | null;
  categoryName?: string | null;
  modalityName?: string | null;
  programPrefix?: string | null;
}

function clean(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  return v === '' ? fallback : v;
}

/** Frase de reconhecimento PT-PT premium e curta; omite modalidade sem deixar buracos. */
export function buildRecognitionBody(input: {
  modalityName: string | null;
  categoryName: string;
  cityName: string;
  programName: string;
  campaignYear: number | null;
}): string {
  const modality = (input.modalityName ?? '').trim();
  const edition = input.campaignYear ? ` — Edição ${input.campaignYear}` : '';
  const merit =
    'Em reconhecimento pelo mérito e destaque alcançados na sua área de atividade,';
  if (modality !== '') {
    return (
      `${merit} distinção ${modality}, na categoria ` +
      `${input.categoryName}, em ${input.cityName}, no âmbito do ` +
      `${input.programName}${edition}.`
    );
  }
  return (
    `${merit} distinção na categoria ${input.categoryName}, ` +
    `em ${input.cityName}, no âmbito do ${input.programName}${edition}.`
  );
}

/**
 * 5C.3.15 — Normaliza nomes longos para composição elegante: colapsa
 * espaços, limita a 120 chars (sem cortar palavra a meio quando possível).
 * O renderer aplica ainda redução automática de font-size + wrap controlado
 * dentro da área segura, por isso o nome nunca sai da área útil.
 * Ex.: "BARCOS ASTEC" e "ASSOCIAÇÃO EMPRESARIAL E COMERCIAL DO VALE DO MINHO".
 */
export function clampDisplayName(raw: string | null | undefined, maxChars = 120): string {
  const v = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (v === '') return '—';
  if (v.length <= maxChars) return v;
  const cut = v.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Linha de distinção curta para o selo (modalidade > categoria). */
export function sealDistinctionShort(input: {
  modalityName: string | null;
  categoryName: string;
}): string {
  const modality = (input.modalityName ?? '').trim();
  if (modality !== '' && modality !== '—') return clampDisplayName(modality, 80);
  return clampDisplayName(input.categoryName, 80);
}

/** Texto do selo: ano e, quando apropriado, modalidade/categoria. */
export function sealYearLine(campaignYear: number | null, programName: string): string {
  if (campaignYear) return `Edição ${campaignYear}`;
  return programName;
}

export function formatIssuedAtPt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Deriva todos os dados visuais da credencial emitida. Fonte de
 * autenticidade = a própria digital_credential (não gera nada novo).
 */
export function resolveCredentialDisplayData(input: ResolveCredentialDataInput): CredentialDisplayData {
  const parentBrandName = clean(input.parentBrandName, 'The Best Europa');
  const programName = clean(input.programName, 'Melhores do Ano Portugal');
  const businessName = clean(input.businessName, '—');
  const cityName = clean(input.cityName, '—');
  const categoryName = clean(input.categoryName, '—');
  const modalityRaw = (input.modalityName ?? '').trim();
  const modalityName = modalityRaw === '' || modalityRaw === '—' ? null : modalityRaw;
  const distinctionLabel = clean(input.distinctionLabel, categoryName);
  const programPrefix = (input.programPrefix ?? 'pt').trim().toLowerCase() || 'pt';
  const verifyPath = verificationUrl(programPrefix, input.credential.verification_code);
  const issuedAtFormatted = formatIssuedAtPt(input.credential.issued_at);
  const editionYear = input.campaignYear ?? null;
  const bodyText = buildRecognitionBody({
    modalityName,
    categoryName,
    cityName,
    programName,
    campaignYear: editionYear,
  });
  return {
    businessName,
    parentBrandName,
    programName,
    campaignYear: editionYear,
    campaignName: input.campaignName ?? null,
    cityName,
    categoryName,
    modalityName,
    distinctionLabel,
    credentialType: input.credential.credential_type,
    verificationCode: input.credential.verification_code,
    issuedAt: input.credential.issued_at,
    issuedAtFormatted,
    status: input.credential.status,
    programPrefix,
    verifyPath,
    headline: 'Certificado',
    introLine: 'Conferimos o presente certificado a:',
    recipientName: businessName,
    bodyText,
    codeLine: `Código de verificação: ${input.credential.verification_code}`,
    issuedLine: `Data de emissão: ${issuedAtFormatted}`,
    editionLine: editionYear ? `${programName} — Edição ${editionYear}` : programName,
  };
}

/** URL absoluta oficial para o QR (ficheiros finais). */
export function absoluteVerifyUrl(origin: string, verifyPath: string): string {
  const base = (origin ?? '').replace(/\/+$/, '');
  const path = verifyPath.startsWith('/') ? verifyPath : `/${verifyPath}`;
  return `${base}${path}`;
}

/** Nome de ficheiro seguro (sem acentos, sem espaços, sem IDs internos). */
export function sanitizeFilenamePart(raw: string | null | undefined): string {
  const ascii = (raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 60);
  return ascii === '' ? 'distincao' : ascii;
}

export function certificateFilename(businessName: string, year: number | null): string {
  const y = year ?? new Date().getFullYear();
  return `the-best-europa-certificado-${sanitizeFilenamePart(businessName)}-${y}.pdf`;
}

export function certificatePngFilename(businessName: string, year: number | null): string {
  const y = year ?? new Date().getFullYear();
  return `the-best-europa-certificado-${sanitizeFilenamePart(businessName)}-${y}.png`;
}

export function sealFilename(businessName: string, year: number | null): string {
  const y = year ?? new Date().getFullYear();
  return `the-best-europa-selo-${sanitizeFilenamePart(businessName)}-${y}.png`;
}
