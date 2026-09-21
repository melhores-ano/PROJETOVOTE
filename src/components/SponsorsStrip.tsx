import { Handshake } from 'lucide-react';
import { useSponsors } from '../hooks/useDirectory';

/**
 * Faixa de patrocinadores do sítio público.
 * Fonte de verdade: tabela `sponsors` (apenas activos).
 */
export function SponsorsStrip() {
  const query = useSponsors();
  const sponsors = query.data ?? [];
  if (!query.loading && sponsors.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-5 pb-4 sm:px-6" aria-label="Patrocinadores">
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.02] px-6 py-8 text-center">
        <p className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          <Handshake className="h-4 w-4 text-gold-400/70" />
          Com o apoio de
        </p>
        {query.loading ? (
          <div className="mx-auto mt-5 flex max-w-lg items-center justify-center gap-3">
            <div className="skeleton h-10 flex-1 rounded-xl" />
            <div className="skeleton h-10 flex-1 rounded-xl" />
          </div>
        ) : (
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {sponsors.map((s) => (
              <li key={s.id}>
                {s.website ? (
                  <a
                    href={s.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-gold-500/50 hover:text-gold-200"
                  >
                    {s.logo_url ? (
                      <img src={s.logo_url} alt={s.name} className="h-6 w-auto object-contain" loading="lazy" />
                    ) : (
                      s.name
                    )}
                    {s.tier && (
                      <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-300">
                        {s.tier}
                      </span>
                    )}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-slate-200">
                    {s.logo_url ? (
                      <img src={s.logo_url} alt={s.name} className="h-6 w-auto object-contain" loading="lazy" />
                    ) : (
                      s.name
                    )}
                    {s.tier && (
                      <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-300">
                        {s.tier}
                      </span>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
