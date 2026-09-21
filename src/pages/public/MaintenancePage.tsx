import { Link } from 'react-router-dom';
import { Award, Wrench } from 'lucide-react';

export default function MaintenancePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-4 text-center font-sans">
      <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-gold-500/20 bg-gold-500/[0.08]">
        <Award className="h-5 w-5 text-gold-400" strokeWidth={2} />
      </span>
      <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
        <Wrench className="h-3.5 w-3.5" />
        Manutenção programada
      </p>
      <h1 className="editorial-h2 mt-4 max-w-md">
        Voltamos já a celebrar Portugal
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
        O sítio dos Melhores do Ano está temporariamente em manutenção para preparar a próxima
        fase da edição. Agradecemos a sua paciência.
      </p>
      <Link
        to="/admin/login"
        className="mt-6 text-xs text-slate-600 underline-offset-4 hover:text-gold-300 hover:underline"
      >
        Acesso de administração
      </Link>
    </div>
  );
}
