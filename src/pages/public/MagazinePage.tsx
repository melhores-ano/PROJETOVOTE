import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import MagazineCover from '../../components/magazine/MagazineCover';
import MagazineFeature from '../../components/magazine/MagazineFeature';
import {
  getPublishedMagazineWithFeatures,
  type PublicMagazineWithFeatures,
} from '../../lib/publicMagazine';

export default function MagazinePage() {
  const { magazineSlug } = useParams<{ magazineSlug: string }>();

  const [data, setData] = useState<PublicMagazineWithFeatures | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMagazine() {
      if (!magazineSlug) {
        setError('Revista não encontrada.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const result = await getPublishedMagazineWithFeatures(
          'melhores-do-ano-portugal',
          magazineSlug,
        );

        if (cancelled) return;

        if (!result) {
          setError('Esta revista ainda não está disponível.');
          setData(null);
          return;
        }

        setData(result);
      } catch {
        if (!cancelled) {
          setError('Não foi possível carregar esta revista.');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMagazine();

    return () => {
      cancelled = true;
    };
  }, [magazineSlug]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-20 text-white">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm uppercase tracking-[0.3em] text-amber-400">
            The Best Europa
          </p>
          <h1 className="mt-4 text-3xl font-bold">A carregar revista...</h1>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-20 text-white">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-amber-400">
            The Best Europa
          </p>
          <h1 className="mt-4 text-4xl font-bold">
            Revista Digital
          </h1>
          <p className="mt-4 text-slate-400">
            {error ?? 'Revista não encontrada.'}
          </p>
        </div>
      </main>
    );
  }

  const { magazine, features } = data;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <MagazineCover
        title={magazine.edition_title}
        subtitle={magazine.edition_subtitle}
        introduction={magazine.edition_introduction}
        cityName={magazine.city_name}
        year={magazine.campaign_year}
        coverImageUrl={magazine.edition_cover_image_url}
      />
      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-400">
            Destaques da edição
          </p>

          <h2 className="mt-3 font-serif text-4xl font-bold">
            Os reconhecidos de {magazine.city_name}
          </h2>
        </div>

        {features.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-slate-400">
            Os conteúdos desta edição serão publicados em breve.
          </div>
        ) : (
          <div className="space-y-12">
          {features.map((feature, index) => (
            <MagazineFeature
              key={feature.editorial_slug}
              feature={feature}
              index={index}
            />
          ))}
          </div>
        )}
      </section>
    </main>
  );
}
