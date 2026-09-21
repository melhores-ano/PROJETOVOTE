import { useState } from 'react';
import { ProgramLink } from '../../hooks/useProgram';
import { ArrowRight, MapPin, Search } from 'lucide-react';
import { useCities, useCitySearch } from '../../hooks/useDirectory';
import { EmptyState, ErrorState, LoadingGrid, SectionHeading } from '../../components/ui';

export default function CitiesPage() {
  const [term, setTerm] = useState('');
  const query = useCities();
  const cities = query.data ?? [];
  const results = useCitySearch(cities, term);

  const districts = [...new Set(cities.map((c) => c.district ?? 'Portugal'))].sort();

  return (
    <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16">
      <SectionHeading
        eyebrow="Onde votar"
        title={<>Escolha a sua cidade</>}
        description="Centenas de cidades portuguesas participam nos Melhores do Ano. Encontre a sua e descubra os negócios nomeados."
      />

      <div className="mx-auto mb-10 flex max-w-xl items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] p-1.5 pl-3.5 backdrop-blur transition focus-within:border-gold-500/40">
        <Search className="h-4 w-4 shrink-0 text-gold-400/80" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Pesquisar por cidade ou distrito…"
          className="w-full bg-transparent py-2 text-[14px] text-white placeholder:text-slate-500 focus:outline-none"
          aria-label="Pesquisar cidade"
        />
      </div>

      {query.loading ? (
        <LoadingGrid count={12} />
      ) : query.error && cities.length === 0 ? (
        <ErrorState message={query.error} onRetry={query.refetch} />
      ) : results.length === 0 ? (
        <EmptyState
          title="Nenhuma cidade encontrada"
          description={`Não encontrámos resultados para “${term}”. Tente outro nome ou explore todas as cidades.`}
          action={
            <button
              onClick={() => setTerm('')}
              className="mt-2 rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300"
            >
              Limpar pesquisa
            </button>
          }
        />
      ) : (
        <>
          <p className="mb-5 text-sm text-slate-400" role="status">
            {results.length} {results.length === 1 ? 'cidade encontrada' : 'cidades encontradas'}
            {term && <> para “<span className="text-gold-300">{term}</span>”</>}
          </p>
          <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((city) => (
              <ProgramLink
                key={city.id}
                to={`/cidade/${city.slug}`}
                className="card-lift group overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.025] hover:border-gold-500/25"
              >
                <div className="relative flex h-28 items-end overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950 p-4">
                  {city.image_url ? (
                    <>
                      <img src={city.image_url} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                      <div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/25 to-transparent" aria-hidden />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-hero-radial" aria-hidden />
                  )}
                  <MapPin className="absolute right-4 top-4 h-4 w-4 text-gold-500/50 transition group-hover:text-gold-400/80" />
                  <p className="relative font-display text-3xl font-bold text-white/10">{city.name.charAt(0)}</p>
                </div>
                <div className="p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {city.district ?? 'Portugal'}
                  </p>
                  <h3 className="mt-1 font-display text-[1.15rem] font-bold text-white">{city.name}</h3>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-400">
                    {city.description ?? 'Descubra os melhores negócios locais.'}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-gold-300/90">
                    Ver categorias <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </ProgramLink>
            ))}
          </div>

          {!term && districts.length > 1 && (
            <div className="mt-10 rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-6">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Por distrito</p>
              <div className="flex flex-wrap gap-2">
                {districts.map((d) => (
                  <button
                    key={d}
                    onClick={() => setTerm(d)}
                    className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300"
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
