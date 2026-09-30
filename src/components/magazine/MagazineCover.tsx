interface MagazineCoverProps {
  title: string;
  subtitle?: string | null;
  introduction?: string | null;
  cityName: string;
  year: number;
  coverImageUrl?: string | null;
}

export default function MagazineCover({
  title,
  subtitle,
  introduction,
  cityName,
  year,
  coverImageUrl,
}: MagazineCoverProps) {
  return (
    <section className="relative isolate min-h-[620px] overflow-hidden border-b border-white/10 bg-slate-950 text-white">
      {coverImageUrl && (
        <img
          src={coverImageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-35"
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/90 to-slate-950/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/20" />

      <div className="relative mx-auto flex min-h-[620px] max-w-7xl items-end px-6 py-16 lg:px-10 lg:py-20">
        <div className="max-w-4xl">
          <p className="text-xs font-bold uppercase tracking-[0.4em] text-amber-400">
            The Best Europa · Revista Digital
          </p>

          <p className="mt-7 text-sm font-semibold uppercase tracking-[0.32em] text-slate-300">
            {cityName} · Edição {year}
          </p>

          <h1 className="mt-5 max-w-4xl font-serif text-5xl font-bold leading-[0.95] md:text-7xl lg:text-8xl">
            {title}
          </h1>

          {subtitle && (
            <p className="mt-8 max-w-2xl text-xl leading-relaxed text-slate-200 md:text-2xl">
              {subtitle}
            </p>
          )}

          {introduction && (
            <p className="mt-7 max-w-2xl text-base leading-8 text-slate-400 md:text-lg">
              {introduction}
            </p>
          )}

          <div className="mt-10 flex items-center gap-4">
            <span className="h-px w-16 bg-amber-400" />
            <span className="text-xs font-bold uppercase tracking-[0.28em] text-amber-400">
              Portugal {year}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}