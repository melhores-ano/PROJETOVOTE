/**
 * THE BEST EUROPA — FASE 5C.3.7 — Faixa visual de contexto Admin.
 *
 * Todas as páginas Admin isoladas por programa/edição apresentam esta
 * faixa para deixar claro QUAL programa e QUAL edição estão em análise.
 * Sem programa válido → alerta fail-closed (sem dados por fallback).
 */
import { AlertTriangle } from 'lucide-react';
import { useAdminProgram } from '../hooks/useAdminProgram';

interface Props {
  /** true quando a página também depende da edição (campaign-scoped). */
  requireCampaign?: boolean;
}

export function AdminScopeBanner({ requireCampaign = false }: Props) {
  const { selectedProgram, selectedCampaign, loading } = useAdminProgram();

  if (loading) {
    return (
      <p className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs text-slate-500" aria-busy="true">
        A carregar contexto do programa…
      </p>
    );
  }

  if (!selectedProgram) {
    return (
      <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Sem programa válido selecionado — selecione um programa no seletor global. Nenhum dado é apresentado por fallback (fail-closed).
      </p>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs" aria-label="Contexto em análise">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 font-semibold text-gold-200">
        PROGRAMA · {selectedProgram.name}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 font-medium text-slate-300">
        País · {selectedProgram.country_code}
      </span>
      {selectedCampaign ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-200">
          EDIÇÃO · {selectedCampaign.year} — {selectedCampaign.name}
        </span>
      ) : requireCampaign ? (
        <span role="alert" className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-semibold text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5" /> Sem edição válida — selecione uma edição do programa
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-medium text-slate-500">
          Sem edição selecionada (entidade independente de edição)
        </span>
      )}
    </div>
  );
}
