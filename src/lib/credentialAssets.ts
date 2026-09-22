/**
 * THE BEST EUROPA — FASE 5C.3.15 — Estado dos assets oficiais.
 *
 * Deteção simples e robusta placeholder vs arte oficial, SEM chamadas de
 * rede: fonte de verdade = CREDENTIAL_ASSET_STATUS em credentialTemplates.ts
 * (configuração explícita). O renderer continua a fazer fallback técnico
 * quando o PNG não carrega, mas o aviso visível e a lógica de "oficial vs
 * placeholder" NÃO dependem de fetch/HEAD.
 *
 * Ativação da arte oficial:
 *   1. colocar public/brand/credentials/certificate-background.png
 *   2. colocar public/brand/credentials/seal-background.png
 *   3. mudar CREDENTIAL_ASSET_STATUS para { certificate: "official", seal: "official" }
 *
 * Sem votos, sem ranking, sem pagamentos, sem banco, sem Storage.
 */
import {
  CREDENTIAL_ASSETS,
  CREDENTIAL_ASSET_STATUS,
  OFFICIAL_ASSET_NOTICE,
  isOfficialAsset,
  type CredentialAssetStatus,
} from '../config/credentialTemplates';

export type { CredentialAssetStatus };

export const DEFINITIVE_CERTIFICATE_PATH = CREDENTIAL_ASSETS.certificateBackground;
export const DEFINITIVE_SEAL_PATH = CREDENTIAL_ASSETS.sealBackground;

export function assetStatusOf(kind: 'certificate' | 'seal'): CredentialAssetStatus {
  return CREDENTIAL_ASSET_STATUS[kind];
}

export function isPlaceholderNoticeVisible(kind: 'certificate' | 'seal'): boolean {
  return !isOfficialAsset(kind);
}

export function placeholderNoticeFor(kind: 'certificate' | 'seal'): string | null {
  if (isOfficialAsset(kind)) return null;
  return `${OFFICIAL_ASSET_NOTICE} Coloque ${
    kind === 'certificate' ? 'certificate-background.png' : 'seal-background.png'
  } em /brand/credentials/.`;
}

export const CREDENTIAL_ARTWORK_STATE = {
  certificate: CREDENTIAL_ASSET_STATUS.certificate,
  seal: CREDENTIAL_ASSET_STATUS.seal,
  certificatePath: DEFINITIVE_CERTIFICATE_PATH,
  sealPath: DEFINITIVE_SEAL_PATH,
} as const;
