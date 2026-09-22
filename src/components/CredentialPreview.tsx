/**
 * THE BEST EUROPA — FASE 5C.3.14 — Pré-visualização de certificado/selo.
 *
 * Estados: loading · erro · credencial ausente · revogada (carimbo REVOGADO)
 * · template ausente (aviso técnico, nunca quebra a página).
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, ShieldAlert } from 'lucide-react';
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
} from '../lib/credentialRenderer';

export type CredentialPreviewKind = 'certificate' | 'seal';

export function CredentialPreview({
  kind,
  data,
  onVerify,
}: {
  kind: CredentialPreviewKind;
  data: CredentialDisplayData | null;
  onVerify?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [usedPlaceholder, setUsedPlaceholder] = useState(false);
  const [busy, setBusy] = useState(false);

  const revoked = data?.status === 'revoked';

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
          const { canvas, usedPlaceholder: ph } = await renderSealCanvas(data, {});
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
  }, [kind, data]);

  async function handleDownload() {
    if (!data || revoked) return;
    setBusy(true);
    try {
      if (kind === 'certificate') {
        await downloadCertificatePdf(data, certificateFilename(data.businessName, data.campaignYear));
      } else {
        await downloadSealPng(data, sealFilename(data.businessName, data.campaignYear));
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
      {usedPlaceholder && state === 'ready' && (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs leading-relaxed text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Aviso técnico: fundo oficial ainda não colocado em /brand/credentials/ — a usar fundo provisório.
          Coloque {kind === 'certificate' ? 'certificate-background.png' : 'seal-background.png'} para a arte definitiva.
        </p>
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
          className={`mx-auto w-full ${kind === 'seal' ? 'max-w-sm' : ''} rounded-xl ${state !== 'ready' ? 'hidden' : ''}`}
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
            {busy ? 'A gerar…' : kind === 'certificate' ? 'Descarregar certificado (PDF A4)' : 'Descarregar selo (PNG)'}
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
