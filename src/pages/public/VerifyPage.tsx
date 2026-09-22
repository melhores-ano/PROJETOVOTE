/**
 * THE BEST EUROPA — FASE 5C.3.13 — Verificação pública de credenciais.
 *
 * Rotas program-aware (Portugal):
 *   /pt/verificar — formulário ("Introduza o código de verificação")
 *   /pt/verificar/:verificationCode — resultado direto (URL verificável p/ QR)
 *
 * Consulta estritamente limitada via RPC pública verify_digital_credential
 * (retorno controlado, fail-closed). Quando válido: CREDENCIAL AUTÊNTICA
 * (programa, edição/ano, empresa, cidade, categoria, modalidade, tipo,
 * código, data de emissão, estado). Quando revogado: CREDENCIAL REVOGADA
 * (código + estado, SEM motivo administrativo). Quando inexistente: CÓDIGO
 * NÃO ENCONTRADO (sem revelar informação interna). NUNCA expõe user ids,
 * notes, commercial_status, votos, IP/hash, audit metadata ou tracking.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, QrCode, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useProgram } from '../../hooks/useProgram';
import { programPaths } from '../../lib/programRoute';
import {
  DIGITAL_CREDENTIAL_TYPE_LABELS,
  normalizeVerificationCode,
  verifyCredentialPublic,
  type PublicCredential,
} from '../../lib/digitalCredentials';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'found'; credential: PublicCredential };

function CredentialCard({ credential }: { credential: PublicCredential }) {
  const revoked = credential.status === 'revoked';
  const typeLabel =
    DIGITAL_CREDENTIAL_TYPE_LABELS[credential.credential_type] ?? credential.credential_type;
  return (
    <div
      className={`overflow-hidden rounded-3xl border backdrop-blur-xl ${
        revoked
          ? 'border-red-500/30 bg-red-500/[0.06]'
          : 'border-emerald-500/30 bg-emerald-500/[0.06]'
      }`}
    >
      <div className="border-b border-white/10 bg-navy-950/60 px-6 py-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          The Best Europa
        </p>
        <h1
          className={`mt-2 flex items-center justify-center gap-2 text-2xl font-bold ${
            revoked ? 'text-red-200' : 'text-emerald-200'
          }`}
        >
          {revoked ? <ShieldAlert className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
          {revoked ? 'Credencial revogada' : 'Credencial autêntica'}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {typeLabel} · {credential.distinction_label}
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 px-6 py-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Empresa / profissional</dt>
          <dd className="mt-0.5 font-semibold text-white">{credential.business_name}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cidade</dt>
          <dd className="mt-0.5 text-slate-200">{credential.city_name}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Categoria</dt>
          <dd className="mt-0.5 text-slate-200">{credential.category_name}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Modalidade</dt>
          <dd className="mt-0.5 text-slate-200">{credential.modality_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Programa</dt>
          <dd className="mt-0.5 text-slate-200">{credential.program_name ?? 'The Best Europa'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Edição</dt>
          <dd className="mt-0.5 text-slate-200">
            {credential.campaign_year ?? '—'}
            {credential.campaign_name ? ` · ${credential.campaign_name}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Código</dt>
          <dd className="mt-0.5 font-mono text-sm font-bold text-gold-300">{credential.verification_code}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Data de emissão</dt>
          <dd className="mt-0.5 text-slate-200">
            {new Date(credential.issued_at).toLocaleDateString('pt-PT')}
          </dd>
        </div>
      </dl>
      <div className="border-t border-white/10 bg-navy-950/60 px-6 py-4">
        <p className="flex items-center gap-2 text-xs leading-relaxed text-slate-400">
          <QrCode className="h-4 w-4 shrink-0" />
          {revoked
            ? 'Esta credencial foi revogada pela organização e já não é válida.'
            : 'Verifique sempre o código no endereço oficial. Esta página é a única prova de autenticidade.'}
        </p>
      </div>
    </div>
  );
}

function VerifyInner() {
  const { prefix, buildPath } = useProgram();
  const params = useParams<{ verificationCode?: string }>();
  const navigate = useNavigate();
  const routeCode = normalizeVerificationCode(params.verificationCode);
  const [input, setInput] = useState(routeCode);
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    setInput(routeCode);
  }, [routeCode]);

  useEffect(() => {
    let cancelled = false;
    if (!routeCode) {
      setState({ kind: 'idle' });
      return;
    }
    (async () => {
      setState({ kind: 'loading' });
      const outcome = await verifyCredentialPublic(routeCode);
      if (cancelled) return;
      if (!outcome.found) setState({ kind: 'not-found' });
      else setState({ kind: 'found', credential: outcome.credential });
    })();
    return () => {
      cancelled = true;
    };
  }, [routeCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeVerificationCode(input);
    if (!code) return;
    navigate(buildPath(`/verificar/${code}`));
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        The Best Europa · Verificação pública
      </p>
      <h1 className="mt-2 text-center text-3xl font-bold text-white">Verificar certificado ou selo</h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-slate-400">
        Introduza o código de verificação impresso no certificado ou no selo digital
        (formato <span className="font-mono text-gold-300">TBE-PT-2026-XXXXXXXXXXXX</span>).
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row"
      >
        <label htmlFor="verification-code" className="sr-only">
          Introduza o código de verificação
        </label>
        <input
          id="verification-code"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder="TBE-PT-2026-…"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-xl border border-white/15 bg-navy-950 px-4 py-3 font-mono text-sm tracking-wider text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110"
        >
          <Search className="h-4 w-4" />
          Verificar
        </button>
      </form>

      <div className="mt-6" aria-live="polite">
        {state.kind === 'loading' && (
          <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-center text-sm text-slate-300">
            A verificar…
          </p>
        )}
        {state.kind === 'not-found' && routeCode && (
          <div className="rounded-2xl border border-white/15 bg-white/[0.02] px-6 py-8 text-center">
            <BadgeCheck className="mx-auto h-8 w-8 text-slate-500" />
            <h2 className="mt-3 text-xl font-bold text-white">Código não encontrado</h2>
            <p className="mt-1 font-mono text-sm text-slate-400">{routeCode}</p>
            <p className="mt-2 text-sm text-slate-500">
              Confirmou bem o código? A verificação é sensível a todos os caracteres.
            </p>
          </div>
        )}
        {state.kind === 'found' && <CredentialCard credential={state.credential} />}
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        <Link to={programPaths.results(prefix)} className="underline hover:text-gold-300">
          Ver resultados oficiais
        </Link>
      </p>
    </div>
  );
}

export default function VerifyPage() {
  return <VerifyInner />;
}
