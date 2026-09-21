import { Trophy } from 'lucide-react';
import { ProgramLink } from '../../hooks/useProgram';

/**
 * FASE 5C.3.4 — Not Found fail-closed (sem dados do programa).
 * Usado tanto em /pt/* como em prefixos inválidos (/fr/, /be/, /xx/):
 * nunca renderiza dados PT. O botão volta ao início do programa actual
 * (ou /pt/ quando fora de contexto).
 */
export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center sm:px-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-gold-500/20 bg-gold-500/[0.08]">
        <Trophy className="h-5 w-5 text-gold-400" />
      </span>
      <p className="mt-6 font-display text-5xl font-bold text-white/20">404</p>
      <h1 className="editorial-h3 mt-2">Página não encontrada</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        O endereço que procura não existe ou foi movido. Volte ao início e continue a explorar
        as cidades participantes.
      </p>
      <ProgramLink
        to="/"
        className="btn-gold-refined mt-6"
      >
        Voltar ao início
      </ProgramLink>
    </div>
  );
}
