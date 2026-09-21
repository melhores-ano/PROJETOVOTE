import { useMemo, useState, type ReactNode } from 'react';
import { Database, Info, Search } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabase';
import { normalize } from '../lib/utils';

export function AdminHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-white">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SupabaseNotice() {
  if (isSupabaseConfigured) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
      <p className="text-[13px] leading-relaxed text-amber-200">
        <strong>Modo de demonstração:</strong> o Supabase ainda não está configurado
        (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Estão a ser apresentados dados de
        recurso locais. Configure o Supabase e execute <code>supabase/migrations/0001_phase1_schema.sql</code> para
        gerir dados reais.
      </p>
    </div>
  );
}

export function AdminCard({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}>
      {title && (
        <header className="border-b border-white/10 bg-navy-900/50 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function AdminTable<T extends object>({
  columns, rows, emptyMessage = 'Sem registos.', searchable = false, searchKeys, searchPlaceholder = 'Pesquisar…',
}: {
  columns: { key: string; label: string; render?: (row: T) => ReactNode }[];
  rows: T[];
  emptyMessage?: string;
  /** Pesquisa client-side sobre os campos de texto da linha (essencial à escala: centenas/milhares de registos). */
  searchable?: boolean;
  searchKeys?: string[];
  searchPlaceholder?: string;
}) {
  const [term, setTerm] = useState('');

  const filtered = useMemo(() => {
    const t = normalize(term.trim());
    if (!searchable || !t) return rows;
    return rows.filter((row) => {
      const record = row as Record<string, unknown>;
      const keys = searchKeys ?? Object.keys(record);
      return keys.some((k) => {
        const v = record[k];
        if (typeof v === 'string') return normalize(v).includes(t);
        if (typeof v === 'number') return String(v).includes(t);
        return false;
      });
    });
  }, [rows, term, searchable, searchKeys]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 py-10 text-center">
        <Database className="h-6 w-6 text-slate-600" />
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      {searchable && rows.length > 3 && (
        <div className="mb-3 flex max-w-sm items-center gap-2 rounded-xl border border-white/15 bg-navy-950/60 px-3.5 transition focus-within:border-gold-500/60">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full bg-transparent py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none"
          />
          {term && (
            <button onClick={() => setTerm('')} className="shrink-0 text-xs text-slate-500 hover:text-white">
              Limpar
            </button>
          )}
        </div>
      )}
      {searchable && term && (
        <p className="mb-3 text-xs text-slate-500" role="status">
          {filtered.length} de {rows.length} registos
        </p>
      )}
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="bg-navy-900/70 text-[11px] uppercase tracking-wider text-slate-400">
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 font-semibold">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {filtered.map((row, i) => (
            <tr key={i} className="transition hover:bg-white/[0.03]">
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3 text-slate-200">
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          Sem resultados para “{term}”.
        </p>
      )}
    </div>
    </div>
  );
}

export function StatusPill({ active, activeLabel = 'Activo', inactiveLabel = 'Inactivo' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
      active
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-white/15 bg-white/5 text-slate-400'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}
