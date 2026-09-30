import type { PublicMagazineImage } from '../../lib/publicMagazine';

interface MagazineGalleryProps {
  images: PublicMagazineImage[];
}

export default function MagazineGallery({
  images,
}: MagazineGalleryProps) {
  if (images.length === 0) return null;

  return (
    <section className="border-t border-white/10 bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-400">
          Galeria
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <figure
              key={`${image.image_url}-${index}`}
              className="overflow-hidden border border-white/10 bg-slate-900"
            >
              <div className="aspect-[4/3] overflow-hidden bg-slate-900">
                <img
                  src={image.image_url}
                  alt={image.caption || `Imagem ${index + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 hover:scale-[1.02]"
                />
              </div>

              {image.caption && (
                <figcaption className="border-t border-white/10 px-4 py-3 text-sm leading-6 text-slate-400">
                  {image.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}