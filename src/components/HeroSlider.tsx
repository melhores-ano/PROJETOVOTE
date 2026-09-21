import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProgramPath } from '../hooks/useProgram';
import { ChevronLeft, ChevronRight, MapPin, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';

/* ============================================================
 * FASE 5B.3 — HERO SLIDER · 3 IMAGENS OFICIAIS INSTALADAS
 * ------------------------------------------------------------
 * - React + Tailwind apenas. Sem bibliotecas externas.
 * - 3 slides configurados via array HERO_SLIDES (textos, rotas,
 *   enquadramento e overlay centralizados — sem hacks no JSX).
 * - Imagens SOMENTE como fundos visuais (decorativas, aria-hidden).
 *   Todos os títulos, descrições e CTAs são HTML/CSS independentes.
 * - Autoplay ~6s, setas, dots, teclado, swipe, pause on hover/focus,
 *   prefers-reduced-motion respeitado, ARIA completo.
 * - Fallback premium navy/dourado se alguma imagem falhar.
 * - Pesquisa de cidade (HomePage) intocada — apenas sobreposta.
 * ============================================================ */

export interface HeroSlideCTA {
  label: string;
  href: string;
  /** 'primary' | 'secondary' — estilo do botão */
  tone: 'primary' | 'secondary';
  icon?: 'mapPin' | 'arrow' | 'sparkles' | 'none';
}

export interface HeroSlide {
  id: string;
  /** Imagem de fundo oficial (WebP otimizado). */
  image: string;
  /** Gradiente de fallback premium (classes tailwind) — sempre por baixo + se a imagem falhar. */
  fallbackGradient: string;
  /** object-position CSS no desktop (ex.: 'center center', '68% center'). */
  desktopPosition: string;
  /** object-position CSS no mobile (≤768px). Prioriza o sujeito de cada foto. */
  mobilePosition: string;
  /** Scrim cinematográfico por slide (CSS background) — garante contraste sem esconder o sujeito. */
  scrim: string;
  eyebrow: string;
  titleA: string;
  titleB: string;
  description: string;
  primaryCTA: HeroSlideCTA;
  secondaryCTA?: HeroSlideCTA;
}

/**
 * ASSETS OFICIAIS (FASE 5B.3) — servidos de /public via Vite:
 *   /brand/hero/hero-01.webp — palco premium The Best Europa, troféu + mapa da
 *     Europa à direita, grande área escura livre à esquerda (imagem institucional).
 *   /brand/hero/hero-02.webp — votação online: pessoas com telemóveis, cenário
 *     português, smartphone ampliado com interface de votação.
 *   /brand/hero/hero-03.webp — reconhecimento: mulher com quadro/certificado
 *     "Espaço Beleza Mais" (dez/2025), cerimónia premium The Best Europa.
 * Originais preservados em /public/hero-0X.webp. NÃO editar
 * /public/brand/the-best-europa.png.
 */
export const HERO_SLIDES: HeroSlide[] = [
  {
    id: 'premiacao',
    image: '/brand/hero/hero-01.webp',
    fallbackGradient: 'from-[#101d38] via-[#0a1628] to-[#050b16]',
    // Troféu à direita permanece visível; texto ocupa a área livre da esquerda.
    desktopPosition: 'center center',
    mobilePosition: '70% center',
    // Mais escuro à esquerda (texto), quase transparente à direita (troféu).
    scrim:
      'linear-gradient(90deg, rgba(4,14,30,.96) 0%, rgba(4,14,30,.82) 35%, rgba(4,14,30,.30) 65%, rgba(4,14,30,.08) 100%)',
    eyebrow: 'The Best Europa · Edição 2026',
    titleA: 'Os Melhores do Ano',
    titleB: 'em Portugal',
    description:
      'A sua cidade. A sua escolha. O seu voto. Celebre os negócios que fazem a diferença em Portugal.',
    primaryCTA: { label: 'Escolher a minha cidade', href: '/cidades', tone: 'primary', icon: 'mapPin' },
    secondaryCTA: { label: 'Como funciona', href: '#como-funciona', tone: 'secondary', icon: 'none' },
  },
  {
    id: 'votacao-online',
    image: '/brand/hero/hero-02.webp',
    fallbackGradient: 'from-[#1a2c4e] via-[#0d1a30] to-[#060c18]',
    // Pessoas + smartphone ampliado: enquadramento protege rostos e o telemóvel
    // principal; bloco de texto à esquerda não os cobre no desktop.
    desktopPosition: '62% center',
    mobilePosition: '64% 30%',
    // Scrim moderado — legibilidade sem destruir a fotografia.
    scrim:
      'linear-gradient(90deg, rgba(4,14,30,.88) 0%, rgba(4,14,30,.62) 38%, rgba(4,14,30,.18) 68%, rgba(4,14,30,.10) 100%)',
    eyebrow: 'Votação 100% online',
    titleA: 'A sua escolha',
    titleB: 'faz a diferença',
    description:
      'Vote online nos negócios que fazem parte da sua cidade e ajude a reconhecer quem se destaca.',
    primaryCTA: { label: 'Começar a votar', href: '/cidades', tone: 'primary', icon: 'sparkles' },
    secondaryCTA: { label: 'Ver cidades', href: '/cidades', tone: 'secondary', icon: 'arrow' },
  },
  {
    id: 'reconhecimento',
    image: '/brand/hero/hero-03.webp',
    fallbackGradient: 'from-[#231a08] via-[#0e1526] to-[#050b16]',
    // Mulher + quadro/certificado protegidos; texto usa a zona livre da esquerda.
    desktopPosition: '60% center',
    mobilePosition: '62% 28%',
    // Scrim moderado — atmosfera da cerimónia preservada.
    scrim:
      'linear-gradient(90deg, rgba(4,14,30,.90) 0%, rgba(4,14,30,.66) 38%, rgba(4,14,30,.22) 68%, rgba(4,14,30,.12) 100%)',
    eyebrow: 'Reconhecimento · Excelência',
    titleA: 'Quem se destaca',
    titleB: 'merece ser reconhecido',
    description:
      'Os mais votados recebem o reconhecimento Melhores do Ano Portugal, uma distinção da The Best Europa.',
    primaryCTA: { label: 'Conhecer a premiação', href: '/sobre', tone: 'primary', icon: 'sparkles' },
    secondaryCTA: { label: 'Ver resultados', href: '/resultados', tone: 'secondary', icon: 'none' },
  },
];

const AUTOPLAY_MS = 6000;

function CTAIcon({ icon }: { icon: NonNullable<HeroSlideCTA['icon']> }) {
  if (icon === 'mapPin') return <MapPin className="h-4 w-4" aria-hidden />;
  if (icon === 'arrow') return <ArrowRight className="h-4 w-4" aria-hidden />;
  if (icon === 'sparkles') return <Sparkles className="h-4 w-4" aria-hidden />;
  return null;
}

function handleCTA(navigate: (to: string) => void, buildPath: (p: string) => string, href: string) {
  if (href.startsWith('#')) {
    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  // FASE 5C.3.4: CTAs internos preservam o prefixo do programa (/pt/).
  navigate(href.startsWith('/') ? buildPath(href) : href);
}

interface HeroSliderProps {
  editionYear?: number;
  className?: string;
  autoplayMs?: number;
}

export function HeroSlider({ editionYear = 2026, className, autoplayMs = AUTOPLAY_MS }: HeroSliderProps) {
  const navigate = useNavigate();
  const buildPath = useProgramPath();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const timer = useRef<number | null>(null);
  const touchX = useRef<number | null>(null);
  const count = HERO_SLIDES.length;

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  );
  const next = useCallback(() => go(index + 1), [go, index]);
  const prev = useCallback(() => go(index - 1), [go, index]);

  /* prefers-reduced-motion */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  /* Preload discreto das imagens (não bloqueante; falha silenciosa → fallback). */
  useEffect(() => {
    HERO_SLIDES.forEach((s, i) => {
      const img = new Image();
      if (i === 0) img.fetchPriority = 'high';
      img.decoding = 'async';
      img.onload = () => setFailedImages((f) => ({ ...f, [s.id]: false }));
      img.onerror = () => setFailedImages((f) => ({ ...f, [s.id]: true }));
      img.src = s.image;
    });
  }, []);

  /* Autoplay com pausa em hover / foco / interação / reduced-motion */
  useEffect(() => {
    if (paused || reducedMotion || count <= 1) return;
    timer.current = window.setTimeout(() => go(index + 1), autoplayMs);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [index, paused, reducedMotion, autoplayMs, go, count]);

  const interactionPause = () => {
    setPaused(true);
    window.setTimeout(() => setPaused(false), 12000);
  };

  return (
    <section
      aria-roledescription="carrossel"
      aria-label={`Destaques — The Best Europa, Edição ${editionYear}`}
      className={cn(
        'group/hero relative overflow-hidden bg-navy-950',
        'min-h-[600px] sm:min-h-[640px] lg:min-h-[680px] lg:max-h-[720px]',
        className,
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
        if (Math.abs(dx) > 48) {
          interactionPause();
          if (dx < 0) next();
          else prev();
        }
        touchX.current = null;
      }}
    >
      {/* ===== Slides ===== */}
      {HERO_SLIDES.map((slide, i) => {
        const active = i === index;
        const imgFailed = failedImages[slide.id] === true;
        return (
          <div
            key={slide.id}
            aria-hidden={!active}
            aria-roledescription="slide"
            aria-label={`${i + 1} de ${count}: ${slide.titleA} ${slide.titleB}`}
            className={cn(
              'absolute inset-0 transition-opacity duration-[1100ms] ease-out',
              active ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0',
            )}
          >
            {/* Fundo: gradiente premium SEMPRE + imagem cover quando existir */}
            <div className={cn('absolute inset-0 bg-gradient-to-br', slide.fallbackGradient)} aria-hidden />
            {!imgFailed && (
              <div className="absolute inset-0 overflow-hidden" aria-hidden>
                <img
                  src={slide.image}
                  alt=""
                  aria-hidden
                  draggable={false}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  fetchPriority={i === 0 ? 'high' : 'auto'}
                  decoding="async"
                  onError={() => setFailedImages((f) => ({ ...f, [slide.id]: true }))}
                  style={{
                    ['--hero-pos-desktop' as string]: slide.desktopPosition,
                    ['--hero-pos-mobile' as string]: slide.mobilePosition,
                  }}
                  className={cn(
                    'hero-img-pos h-full w-full object-cover',
                    !reducedMotion && active && 'hero-kenburns',
                  )}
                />
              </div>
            )}
            {/* Scrim por slide — contraste do texto sem esconder o sujeito */}
            <div className="absolute inset-0" style={{ background: slide.scrim }} aria-hidden />
            {/* Véu inferior: leitura perfeita junto ao card de pesquisa sobreposto */}
            <div
              className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/20 to-navy-950/30"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute left-1/2 top-[-140px] h-[320px] w-[640px] -translate-x-1/2 rounded-full bg-gold-500/[0.07] blur-[100px]"
              aria-hidden
            />
            {/* Filigrana dourada subtil — luxo discreto, sem efeito casino */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent"
              aria-hidden
            />
          </div>
        );
      })}

      {/* ===== Conteúdo (HTML independente das fotografias) — FASE 5B.4: escala editorial reduzida ===== */}
      <div className="relative z-20 mx-auto flex min-h-[inherit] max-w-7xl flex-col justify-center px-5 pb-36 pt-14 sm:px-6 sm:pb-40 lg:pb-44">
        <div className="max-w-[660px]" aria-live="polite">
          {HERO_SLIDES.map((slide, i) => {
            const active = i === index;
            return (
              <div
                key={slide.id}
                className={cn(
                  active ? 'hero-slide-enter' : 'hidden',
                )}
                hidden={!active}
              >
                <p className="hero-anim-1 inline-flex items-center gap-2 rounded-full border border-white/10 bg-navy-950/55 py-1 pl-1.5 pr-3.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-300 backdrop-blur">
                  <span className="inline-flex items-center rounded-full bg-gold-500/90 px-2 py-0.5 text-[9px] font-semibold tracking-[0.14em] text-navy-950">
                    {editionYear}
                  </span>
                  <span className="text-slate-300/90">{slide.eyebrow}</span>
                </p>
                <h1 className="hero-anim-2 hero-headline mt-5">
                  {slide.titleA}
                  <br />
                  <span className="text-gold-gradient">{slide.titleB}</span>
                </h1>
                <p className="hero-anim-3 hero-description mt-4">
                  {slide.description}
                </p>
                <div className="hero-anim-4 mt-7 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                  <button
                    onClick={() => handleCTA(navigate, buildPath, slide.primaryCTA.href)}
                    tabIndex={active ? 0 : -1}
                    className="btn-gold-refined w-full sm:w-auto"
                  >
                    <CTAIcon icon={slide.primaryCTA.icon ?? 'none'} />
                    {slide.primaryCTA.label}
                  </button>
                  {slide.secondaryCTA && (
                    <button
                      onClick={() => handleCTA(navigate, buildPath, slide.secondaryCTA!.href)}
                      tabIndex={active ? 0 : -1}
                      className="btn-ghost-refined w-full sm:w-auto"
                    >
                      {slide.secondaryCTA.icon && slide.secondaryCTA.icon !== 'none' && (
                        <CTAIcon icon={slide.secondaryCTA.icon} />
                      )}
                      {slide.secondaryCTA.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hierarquia da marca — reforço institucional discreto */}
        <p className="mt-9 hidden items-center gap-2.5 text-[10px] font-medium uppercase tracking-[0.24em] text-slate-500 sm:flex">
          <span className="text-gold-500/70">The Best Europa</span>
          <span aria-hidden className="text-slate-700">→</span>
          <span className="text-slate-500">Melhores do Ano Portugal</span>
          <span aria-hidden className="text-slate-700">→</span>
          <span className="text-slate-500">Edição {editionYear}</span>
        </p>
      </div>

      {/* ===== Controlos ===== */}
      <div className="absolute inset-x-0 bottom-28 z-30 sm:bottom-32">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-5 sm:px-6">
          {/* Dots */}
          <div className="flex items-center gap-2.5" role="tablist" aria-label="Escolher destaque">
            {HERO_SLIDES.map((slide, i) => {
              const active = i === index;
              return (
                <button
                  key={slide.id}
                  role="tab"
                  aria-selected={active}
                  aria-label={`Ir para destaque ${i + 1}: ${slide.titleA} ${slide.titleB}`}
                  onClick={() => {
                    interactionPause();
                    go(i);
                  }}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300 focus-visible:outline-2 focus-visible:outline-gold-400',
                    active
                      ? 'w-8 bg-gold-500/90'
                      : 'w-1.5 bg-white/25 hover:bg-white/50',
                  )}
                />
              );
            })}
          </div>
          {/* Setas */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                interactionPause();
                prev();
              }}
              aria-label="Destaque anterior"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-navy-950/55 text-slate-300 backdrop-blur transition hover:border-gold-500/40 hover:text-gold-300 active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              onClick={() => {
                interactionPause();
                next();
              }}
              aria-label="Próximo destaque"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-navy-950/55 text-slate-300 backdrop-blur transition hover:border-gold-500/40 hover:text-gold-300 active:scale-95"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {/* Teclado: ← → navegam (região focável, sem roubar foco global) */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Controlos do carrossel por teclado: use as setas esquerda e direita"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            interactionPause();
            prev();
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            interactionPause();
            next();
          }
        }}
        className="absolute inset-x-0 top-0 z-0 h-10 opacity-0 focus-visible:opacity-100"
      />
    </section>
  );
}

export default HeroSlider;
