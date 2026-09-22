/**
 * THE BEST EUROPA — FASE 5C.3.15 — Pré-visualização de certificado/selo.
 *
 * Estados: loading · erro · credencial ausente · revogada (carimbo REVOGADO)
 * · template ausente (aviso técnico, nunca quebra a página).
 *
 * 5C.3.15:
 *  - certificado: preview landscape (proporção A4 real);
 *  - selo: preview quadrado/transparente + alternador clean/verificável;
 *  - aviso "Arte oficial ainda não instalada — utilizando placeholder
 *    técnico." SOMENTE quando CREDENTIAL_ASSET_STATUS = placeholder;
 *    quando o PNG oficial existir (status official), o aviso desaparece.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, ShieldAlert } from 'lucide-react';
import { isOfficialAsset } from '../config/credentialTemplates';
import type { CredentialDisplayData } from '../lib/credentialData';
import {
  certificateFilename,
  certificatePngFilename,
  sealFilename,
} from '../lib/credentialData';
import {
  checkTemplateAvailability,
  downloadCanvasPng,
  downloadCertificatePdf,
  downloadSealPng,
  renderCertificateCanvas,
  renderSealCanvas,
  type SealVariant,
} from '../lib/credentialRenderer';

export type CredentialPreviewKind = 'certificate' | 'seal';

export function CredentialPreview({
  kind,
  data,
  onVerify,
  initialSealVariant = 'verifiable',
}: {
  kind: CredentialPreviewKind;
  data: CredentialDisplayData | null;
  onVerify?: () => void;
  initialSealVariant?: SealVariant;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [usedPlaceholder, setUsedPlaceholder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sealVariant, setSealVariant] = useState<SealVariant>(initialSealVariant);

  const revoked = data?.status === 'revoked';
  // Fonte de verdade do aviso: configuração explícita (sem rede).
  const officialInstalled = kind === 'certificate'
    ? isOfficialAsset('certificate')
    : isOfficialAsset('seal');
  const showPlaceholderNotice = !officialInstalled || usedPlaceholder;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!data) {
        setState('error');
        setError('Credencial ausente — selecione uma credencial emitida válida.');
        return;
      }
      setState('loading');
      setError(null);
      try {
        await checkTemplateAvailability().catch(() => ({ certificateBackground: false, sealBackground: false }));
        if (kind === 'certificate') {
          const { canvas, usedPlaceholder: ph } = await renderCertificateCanvas(data, { scale: 0.35 });
          if (cancelled) return;
          setUsedPlaceholder(ph);
          const host = canvasRef.current;
          if (host) {
            host.width = canvas.width;
            host.height = canvas.height;
            const ctx = host.getContext('2d');
            if (ctx) ctx.drawImage(canvas, 0, 0);
            (host as HTMLCanvasElement & { __src?: HTMLCanvasElement }).__src = canvas;
          }
        } else {
          const { canvas, usedPlaceholder: ph } = await renderSealCanvas(data, { variant: sealVariant });
          if (cancelled) return;
          setUsedPlaceholder(ph);
          const host = canvasRef.current;
          if (host) {
            host.width = canvas.width;
            host.height = canvas.height;
            const ctx = host.getContext('2d');
            if (ctx) ctx.drawImage(canvas, 0, 0);
            (host as HTMLCanvasElement & { __src?: HTMLCanvasElement }).__src = canvas;
          }
        }
        if (!cancelled) setState('ready');
      } catch (e) {
        if (!cancelled) {
          setState('error');
          setError(e instanceof Error ? e.message : 'Falha ao renderizar a pré-visualização.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, data, sealVariant]);

  async function handleDownload() {
    if (!data || revoked) return;
    setBusy(true);
    try {
      if (kind === 'certificate') {
        await downloadCertificatePdf(data, certificateFilename(data.businessName, data.campaignYear));
      } else {
        await downloadSealPng(data, sealFilename(data.businessName, data.campaignYear), sealVariant);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no download.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadPng() {
    if (!data || revoked) return;
    setBusy(true);
    try {
      const host = canvasRef.current as (HTMLCanvasElement & { __src?: HTMLCanvasElement }) | null;
      const src = host?.__src ?? host;
      if (!src) throw new Error('Pré-visualização ainda não renderizada.');
      const name =
        kind === 'certificate'
          ? certificatePngFilename(data.businessName, data.campaignYear)
          : sealFilename(data.businessName, data.campaignYear);
      await downloadCanvasPng(src, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no download.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div role="alert" className="rounded-2xl border border-white/15 bg-white/[0.02] px-5 py-6 text-center text-sm text-slate-300">
        Credencial ausente — selecione uma credencial emitida válida.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {revoked && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-200">
          <ShieldAlert className="h-4 w-4" />
          REVOGADO — esta credencial já não é válida. Geração e download bloqueados.
        </p>
      )}
      {showPlaceholderNotice && state === 'ready' && (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs leading-relaxed text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Arte oficial ainda não instalada — utilizando placeholder técnico.
          Coloque {kind === 'certificate' ? 'certificate-background.png' : 'seal-background.png'} em /brand/credentials/ para a arte definitiva.
        </p>
      )}
      {kind === 'seal' && state === 'ready' && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Variante do selo">
          <button
            type="button"
            onClick={() => setSealVariant('clean')}
            aria-pressed={sealVariant === 'clean'}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
              sealVariant === 'clean'
                ? 'bg-gold-gradient text-navy-950 shadow-award'
                : 'border border-white/15 text-slate-300 hover:border-gold-500/50 hover:text-gold-300'
            }`}
          >
            Selo limpo (sem QR)
          </button>
          <button
            type="button"
            onClick={() => setSealVariant('verifiable')}
            aria-pressed={sealVariant === 'verifiable'}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
              sealVariant === 'verifiable'
                ? 'bg-gold-gradient text-navy-950 shadow-award'
                : 'border border-white/15 text-slate-300 hover:border-gold-500/50 hover:text-gold-300'
            }`}
          >
            Selo verificável (com QR)
          </button>
          <span className="text-[11px] text-slate-500">
            {sealVariant === 'clean'
              ? 'Para website, redes sociais, publicidade e assinatura digital.'
              : 'Com QR e código de autenticidade. Mesma credencial.'}
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-navy-950/60 p-3">
        {state === 'loading' && (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> A renderizar pré-visualização…
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="px-4 py-8 text-center text-sm text-red-300">
            {error ?? 'Falha ao renderizar.'}
          </p>
        )}
        <canvas
          ref={canvasRef}
          className={`mx-auto w-full ${kind === 'certificate' ? 'aspect-[297/210]' : 'max-w-sm aspect-square'} rounded-xl ${state !== 'ready' ? 'hidden' : ''} ${kind === 'seal' ? 'bg-[repeating-conic-gradient(#1a1a22_0%_25%,#101014_0%_50%)] bg-[length:24px_24px]' : ''}`}
          aria-label={kind === 'certificate' ? 'Pré-visualizar certificado' : 'Pré-visualizar selo'}
        />
      </div>
      {state === 'ready' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy || revoked}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gold-gradient px-4 py-2 text-xs font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            {busy ? 'A gerar…' : kind === 'certificate' ? 'Descarregar certificado (PDF A4)' : `Descarregar selo ${sealVariant === 'clean' ? 'limpo' : 'verificável'} (PNG)`}
          </button>
          {kind === 'certificate' && (
            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={busy || revoked}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-slate-200 transition hover:border-gold-500/50 hover:text-gold-300 disabled:opacity-40"
            >
              Descarregar PNG
            </button>
          )}
          {onVerify && (
            <button
              type="button"
              onClick={onVerify}
              className="inline-flex items-center gap-1.5 rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-2 text-xs font-semibold text-teal-200 transition hover:bg-teal-500/20"
            >
              Verificar autenticidade
            </button>
          )}
        </div>
      )}
      {state === 'error' && error && (
        <p role="alert" className="text-xs text-red-300">{error}</p>
      )}
    </div>
  );
}
