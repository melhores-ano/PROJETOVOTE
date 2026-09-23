/**
 * FASE 5C.3.16.2 — PREVIEW LOCAL / NÃO PERSISTENTE (DEV ONLY).
 *
 * Página temporária de validação visual humana das artes oficiais já
 * instaladas (INTACTAS, sem redesenho — correção final só do bloco de
 * autenticação do certificado: duas zonas, QR inferior direito à direita
 * da assinatura, bloco 4 linhas à esquerda do QR). NÃO lê nem escreve no
 * Supabase. NÃO cria distinção, empresa ou credencial real. Usa APENAS os
 * renderers existentes da 5C.3.16.2
 * (credentialRenderer + CredentialPreview + credentialTemplates).
 *
 * Sample local previsto na fase:
 *   Empresa: BARCOS ASTEC | Programa: Melhores do Ano Portugal | Ano: 2026
 *   Cidade: Valença do Minho | Categoria: Comércio Local
 *   Modalidade: Destaque Empresarial | Código: TBE-TEST-2026
 *
 * Rota DEV: /dev/preview-5c316 (fora do ProgramGate, sem backend).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CredentialPreview } from '../../components/CredentialPreview';
import { resolveCredentialDisplayData } from '../../lib/credentialData';

const SAMPLE = {
  businessName: 'BARCOS ASTEC',
  parentBrandName: 'The Best Europa',
  programName: 'Melhores do Ano Portugal',
  campaignYear: 2026,
  campaignName: 'Melhores do Ano Portugal 2026',
  cityName: 'Valença do Minho',
  categoryName: 'Comércio Local',
  modalityName: 'Destaque Empresarial',
  distinctionLabel: 'Destaque Empresarial',
  verificationCode: 'TBE-TEST-2026',
  issuedAt: '2026-09-23T10:00:00.000Z',
  programPrefix: 'pt',
} as const;

export default function Preview516Page() {
  const certificateData = useMemo(
    () =>
      resolveCredentialDisplayData({
        credential: {
          credential_type: 'certificate',
          verification_code: SAMPLE.verificationCode,
          issued_at: SAMPLE.issuedAt,
          status: 'issued',
        },
        distinctionLabel: SAMPLE.distinctionLabel,
        businessName: SAMPLE.businessName,
        parentBrandName: SAMPLE.parentBrandName,
        programName: SAMPLE.programName,
        campaignYear: SAMPLE.campaignYear,
        campaignName: SAMPLE.campaignName,
        cityName: SAMPLE.cityName,
        categoryName: SAMPLE.categoryName,
        modalityName: SAMPLE.modalityName,
        programPrefix: SAMPLE.programPrefix,
      }),
    [],
  );

  const sealData = useMemo(
    () =>
      resolveCredentialDisplayData({
        credential: {
          credential_type: 'digital_seal',
          verification_code: SAMPLE.verificationCode,
          issued_at: SAMPLE.issuedAt,
          status: 'issued',
        },
        distinctionLabel: SAMPLE.distinctionLabel,
        businessName: SAMPLE.businessName,
        parentBrandName: SAMPLE.parentBrandName,
        programName: SAMPLE.programName,
        campaignYear: SAMPLE.campaignYear,
        campaignName: SAMPLE.campaignName,
        cityName: SAMPLE.cityName,
        categoryName: SAMPLE.categoryName,
        modalityName: SAMPLE.modalityName,
        programPrefix: SAMPLE.programPrefix,
      }),
    [],
  );

  return (
    <div className="min-h-screen bg-navy-950 text-slate-100">
      {/* Faixa DEV — inconfundível */}
      <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center">
        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-amber-300">
          Preview local · Não persistente · Não tocar no Supabase
        </p>
        <p className="mt-1 text-[11px] text-amber-200/80">
          FASE 5C.3.16.2 — correção final do bloco de autenticação · sample TBE-TEST-2026 · sem DB, sem votos, sem ranking
        </p>
      </div>

      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8">
        <header className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
          <h1 className="bg-gold-gradient bg-clip-text text-2xl font-extrabold text-transparent">
            5C.3.16.2 — Correção final do bloco de autenticação (BARCOS ASTEC)
          </h1>
          <dl className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <div><dt className="inline text-slate-500">Empresa: </dt><dd className="inline font-semibold text-slate-100">BARCOS ASTEC</dd></div>
            <div><dt className="inline text-slate-500">Programa: </dt><dd className="inline font-semibold text-slate-100">Melhores do Ano Portugal</dd></div>
            <div><dt className="inline text-slate-500">Ano: </dt><dd className="inline font-semibold text-slate-100">2026</dd></div>
            <div><dt className="inline text-slate-500">Cidade: </dt><dd className="inline font-semibold text-slate-100">Valença do Minho</dd></div>
            <div><dt className="inline text-slate-500">Categoria: </dt><dd className="inline font-semibold text-slate-100">Comércio Local</dd></div>
            <div><dt className="inline text-slate-500">Modalidade: </dt><dd className="inline font-semibold text-slate-100">Destaque Empresarial</dd></div>
            <div><dt className="inline text-slate-500">Código: </dt><dd className="inline font-mono font-semibold text-gold-300">TBE-TEST-2026</dd></div>
            <div><dt className="inline text-slate-500">Persistência: </dt><dd className="inline font-semibold text-teal-300">nenhuma (mock em memória)</dd></div>
          </dl>
          <nav className="mt-4 flex flex-wrap gap-2 text-xs">
            <a href="#certificado" className="rounded-xl border border-white/15 px-3 py-1.5 hover:border-gold-500/50 hover:text-gold-300">1 · Certificado oficial</a>
            <a href="#selo-limpo" className="rounded-xl border border-white/15 px-3 py-1.5 hover:border-gold-500/50 hover:text-gold-300">2 · Selo limpo (sem QR)</a>
            <a href="#selo-verificavel" className="rounded-xl border border-white/15 px-3 py-1.5 hover:border-gold-500/50 hover:text-gold-300">3 · Selo verificável (com QR)</a>
          </nav>
        </header>

        <section id="certificado" aria-label="Certificado oficial preenchido" className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-bold text-slate-100">1 · Certificado oficial preenchido</h2>
          <p className="mt-1 text-xs text-slate-400">Renderer 5C.3.16.2 · arte oficial em cover · zona superior (texto principal) + zona inferior direita (bloco 4 linhas à esquerda do QR, QR à direita da assinatura, legenda imediatamente abaixo) · sem redesenho.</p>
          <div className="mt-4">
            <CredentialPreview kind="certificate" data={certificateData} />
          </div>
        </section>

        <section id="selo-limpo" aria-label="Selo oficial limpo sem QR" className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-bold text-slate-100">2 · Selo oficial limpo, sem QR</h2>
          <p className="mt-1 text-xs text-slate-400">Renderer 5C.3.16.2 · variante clean INTACTA · arte pura em contain · sem QR, sem código.</p>
          <div className="mt-4">
            <CredentialPreview kind="seal" data={sealData} initialSealVariant="clean" />
          </div>
        </section>

        <section id="selo-verificavel" aria-label="Selo oficial verificável com QR e código" className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-bold text-slate-100">3 · Selo oficial verificável, com QR e código</h2>
          <p className="mt-1 text-xs text-slate-400">Renderer 5C.3.16.2 · variante verifiable INTACTA · mesma credencial · medalhão intacto em cima, QR + código + micro-legenda fora do medalhão, em baixo.</p>
          <div className="mt-4">
            <CredentialPreview kind="seal" data={sealData} initialSealVariant="verifiable" />
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 pb-8 text-[11px] text-slate-500">
          <span>Preview DEV local — dados de demonstração em memória, nada foi gravado no Supabase.</span>
          <Link to="/" className="underline hover:text-gold-300">Voltar ao início</Link>
        </footer>
      </main>
    </div>
  );
}
