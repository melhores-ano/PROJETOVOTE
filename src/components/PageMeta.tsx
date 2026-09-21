import { useEffect } from 'react';

export interface PageSeo {
  title: string;
  description?: string;
  /** Caminho canónico, ex.: "/pt/braga/barbearias/resultados" */
  canonicalPath?: string;
  /** Tipo Open Graph (default "website") */
  ogType?: string;
  /** URL absoluta da imagem de partilha */
  ogImage?: string;
  /** Locale dinâmico da rota (default "pt-PT"; preparado p/ futuros programas). */
  locale?: string;
  /** Dados estruturados JSON-LD (ItemList, Article, etc.) */
  structuredData?: Record<string, unknown> | Record<string, unknown>[];
}

const SITE_NAME = 'Prémios Melhores do Ano Portugal';
const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined ?? '').replace(/\/$/, '');

function upsertMeta(selector: string, create: () => HTMLMetaElement): HTMLMetaElement {
  const existing = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (existing) return existing;
  const el = create();
  document.head.appendChild(el);
  return el;
}

/**
 * SEO por rota: título do separador + meta description + Open Graph.
 * - `usePageMeta` para títulos dinâmicos (ex.: nome da cidade/empresa).
 * - `<PageMeta>` para títulos estáticos declarados no router.
 * Suporta canonical, OG (title/description/type/image/url/locale) e JSON-LD.
 */
export function usePageMeta(title: string, description?: string, opts?: Omit<PageSeo, 'title' | 'description'>): void {
  useEffect(() => {
    const full = title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
    document.title = full;
    // FASE 5C.3.4: lang acompanha o locale do programa da rota.
    // Só existe pt-PT nesta fase; NÃO inventar hreflang FR/BE.
    const locale = opts?.locale ?? 'pt-PT';
    document.documentElement.lang = locale;

    if (description) {
      const meta = upsertMeta('meta[name="description"]', () => {
        const el = document.createElement('meta');
        el.setAttribute('name', 'description');
        return el;
      });
      meta.setAttribute('content', description);

      const ogDesc = upsertMeta('meta[property="og:description"]', () => {
        const el = document.createElement('meta');
        el.setAttribute('property', 'og:description');
        return el;
      });
      ogDesc.setAttribute('content', description);
    }

    const ogTitle = upsertMeta('meta[property="og:title"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('property', 'og:title');
      return el;
    });
    ogTitle.setAttribute('content', full);

    const ogType = upsertMeta('meta[property="og:type"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('property', 'og:type');
      return el;
    });
    ogType.setAttribute('content', opts?.ogType ?? 'website');

    const ogLocale = upsertMeta('meta[property="og:locale"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('property', 'og:locale');
      return el;
    });
    ogLocale.setAttribute('content', locale.replace('-', '_'));

    const ogSite = upsertMeta('meta[property="og:site_name"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('property', 'og:site_name');
      return el;
    });
    ogSite.setAttribute('content', SITE_NAME);

    if (opts?.ogImage) {
      const ogImg = upsertMeta('meta[property="og:image"]', () => {
        const el = document.createElement('meta');
        el.setAttribute('property', 'og:image');
        return el;
      });
      ogImg.setAttribute('content', opts.ogImage);
    }

    // Canonical + og:url
    let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (opts?.canonicalPath) {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
      }
      const href = SITE_URL ? `${SITE_URL}${opts.canonicalPath}` : opts.canonicalPath;
      canonical.setAttribute('href', href);
      const ogUrl = upsertMeta('meta[property="og:url"]', () => {
        const el = document.createElement('meta');
        el.setAttribute('property', 'og:url');
        return el;
      });
      ogUrl.setAttribute('content', href);
    }

    // JSON-LD estruturado (substitui o bloco anterior da mesma página)
    const prevLd = document.head.querySelector('script[data-page-ld="1"]');
    if (prevLd) prevLd.remove();
    if (opts?.structuredData) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-page-ld', '1');
      script.text = JSON.stringify(opts.structuredData);
      document.head.appendChild(script);
    }
  }, [title, description, opts?.canonicalPath, opts?.ogImage, opts?.ogType, opts?.locale, JSON.stringify(opts?.structuredData ?? null)]);
}

export function PageMeta({ title, description, canonicalPath, ogImage, ogType, locale, structuredData }: PageSeo) {
  usePageMeta(title, description, { canonicalPath, ogImage, ogType, locale, structuredData });
  return null;
}
