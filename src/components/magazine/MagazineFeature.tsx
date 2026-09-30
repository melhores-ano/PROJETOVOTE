import type { PublicMagazineFeature } from '../../lib/publicMagazine';
import MagazineGallery from './MagazineGallery';

interface MagazineFeatureProps {
  feature: PublicMagazineFeature;
  index: number;
}

export default function MagazineFeature({
  feature,
  index,
}: MagazineFeatureProps) {
  const imageUrl =
    feature.cover_image_url ||
    feature.business_cover_url ||
    feature.images?.[0]?.image_url ||
    null;

  const galleryImages = (feature.cover_image_url || feature.business_cover_url) ? feature.images.slice(1) : feature.images;

  const isEven = index % 2 === 1;

  return (
    <article className="overflow-hidden border-y border-white/10 bg-slate-950">
      <div
        className={`mx-auto grid max-w-7xl items-stretch lg:grid-cols-2 ${
          isEven ? 'lg:[&>*:first-child]:order-2' : ''
        }`}
      >
        <div className="relative min-h-[360px] bg-slate-900 lg:min-h-[620px]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={feature.business_name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 px-10 text-center">
              <span className="font-serif text-4xl font-bold text-white/20">
                {feature.business_name}
              </span>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent lg:hidden" />
        </div>

        <div className="flex min-h-[520px] items-center px-7 py-12 md:px-12 lg:min-h-[620px] lg:px-16">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-400">
              {feature.category_name}
              {feature.area_name ? ` · ${feature.area_name}` : ''}
            </p>

            <div className="mt-7 h-px w-14 bg-amber-400" />

            <h2 className="mt-7 font-serif text-4xl font-bold leading-tight text-white md:text-5xl">
              {feature.title || feature.business_name}
            </h2>

            {feature.subtitle && (
              <p className="mt-6 text-xl leading-relaxed text-slate-300">
                {feature.subtitle}
              </p>
            )}

            {feature.body && (
              <p className="mt-7 whitespace-pre-line text-base leading-8 text-slate-400">
                {feature.body}
              </p>
            )}

            {feature.show_official_seal && (
              <div className="mt-9 border-l-2 border-emerald-400 pl-4">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">
                  Reconhecimento Oficial
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  The Best Europa · Edição 2026
                </p>
              </div>
            )}

            {feature.cta_label && feature.cta_url && (
              <a
                href={feature.cta_url}
                target="_blank"
                rel="noreferrer"
                className="mt-10 inline-flex border border-amber-400 px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-amber-400 transition hover:bg-amber-400 hover:text-slate-950"
              >
                {feature.cta_label}
              </a>
            )}
          </div>
        </div>
      </div>
      <MagazineGallery images={galleryImages} />
    </article>
  );
}