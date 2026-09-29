import { useState } from 'react';
import { Download, ExternalLink, PackageCheck } from 'lucide-react';

import type { CredentialDisplayData } from '../lib/credentialData';
import {
  downloadCertificatePdf,
  downloadCertificatePng,
  downloadSealPng,
} from '../lib/credentialRenderer';

interface WinnerDigitalKitProps {
  certificate: CredentialDisplayData;
  seal: CredentialDisplayData;
  onVerifyCertificate?: () => void;
  onVerifySeal?: () => void;
}

export function WinnerDigitalKit({
  certificate,
  seal,
  onVerifyCertificate,
  onVerifySeal,
}: WinnerDigitalKitProps) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDownload(key: string, action: () => Promise<void>) {
    setError(null);
    setDownloading(key);

    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar o ficheiro.');
    } finally {
      setDownloading(null);
    }
  }

  const year = certificate.campaignYear ?? new Date().getFullYear();
  const business = certificate.businessName;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
        <div className="flex items-start gap-3">
          <PackageCheck className="mt-0.5 h-5 w-5 text-emerald-300" />
          <div>
            <h3 className="font-semibold text-emerald-100">
              Kit Digital do Vencedor
            </h3>
            <p className="mt-1 text-sm text-slate-300">
              {business} · {certificate.cityName} · {certificate.categoryName}
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={downloading !== null}
          onClick={() =>
            runDownload('certificate-pdf', () =>
              downloadCertificatePdf(
                certificate,
                `certificado-${business}-${year}.pdf`,
              ),
            )
          }
          className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left transition hover:border-gold-500/50 disabled:opacity-50"
        >
          <span>
            <strong className="block text-sm text-white">Certificado PDF</strong>
            <small className="text-slate-400">Documento oficial A4</small>
          </span>
          <Download className="h-5 w-5" />
        </button>

        <button
          type="button"
          disabled={downloading !== null}
          onClick={() =>
            runDownload('certificate-png', () =>
              downloadCertificatePng(
                certificate,
                `certificado-${business}-${year}.png`,
              ),
            )
          }
          className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left transition hover:border-gold-500/50 disabled:opacity-50"
        >
          <span>
            <strong className="block text-sm text-white">Certificado PNG</strong>
            <small className="text-slate-400">Imagem em alta resolução</small>
          </span>
          <Download className="h-5 w-5" />
        </button>

        <button
          type="button"
          disabled={downloading !== null}
          onClick={() =>
            runDownload('seal-clean', () =>
              downloadSealPng(
                seal,
                `selo-${business}-${year}-limpo.png`,
                'clean',
              ),
            )
          }
          className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left transition hover:border-gold-500/50 disabled:opacity-50"
        >
          <span>
            <strong className="block text-sm text-white">Selo limpo PNG</strong>
            <small className="text-slate-400">Para website e redes sociais</small>
          </span>
          <Download className="h-5 w-5" />
        </button>

        <button
          type="button"
          disabled={downloading !== null}
          onClick={() =>
            runDownload('seal-verifiable', () =>
              downloadSealPng(
                seal,
                `selo-${business}-${year}-verificavel.png`,
                'verifiable',
              ),
            )
          }
          className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left transition hover:border-gold-500/50 disabled:opacity-50"
        >
          <span>
            <strong className="block text-sm text-white">Selo verificável PNG</strong>
            <small className="text-slate-400">Inclui QR e código de autenticidade</small>
          </span>
          <Download className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onVerifyCertificate}
          className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200"
        >
          <ExternalLink className="h-4 w-4" />
          Verificar certificado
        </button>

        <button
          type="button"
          onClick={onVerifySeal}
          className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200"
        >
          <ExternalLink className="h-4 w-4" />
          Verificar selo
        </button>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
        Kit oficial associado à distinção de {business}. Os materiais utilizam as
        mesmas credenciais verificáveis emitidas pelo The Best Europa.
      </div>
    </div>
  );
}