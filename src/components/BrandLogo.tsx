import { useState } from 'react';
import { Link } from 'react-router-dom';
import { brand } from '../config/brand';
import { useProgram } from '../hooks/useProgram';
import { cn } from '../lib/utils';

export type BrandLogoVariant = 'public' | 'admin' | 'login' | 'footer';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  className?: string;
  /** Quando true, o logo é clicável e navega para "/" (header/footer). */
  linkToHome?: boolean;
  /** Texto alternativo da imagem. Por omissão: "The Best Europa". */
  alt?: string;
  /** Desativa o fallback para o caminho legado. */
  disableFallback?: boolean;
}

/**
 * Componente central de marca — FASE 5B.1.
 *
 * Utiliza o logótipo oficial em `/brand/the-best-europa.png`.
 * NÃO recria nem redesenha o logo. NÃO duplica markup em vários componentes.
 *
 * Variantes:
 * - public: header público (altura média)
 * - admin: sidebar admin (compacta)
 * - login: página de login (destaque)
 * - footer: rodapé (média, com brilho subtil em hover)
 */
export function BrandLogo({
  variant = 'public',
  className,
  linkToHome = false,
  alt,
  disableFallback = false,
}: BrandLogoProps) {
  const [src, setSrc] = useState(brand.logoPath);
  // FASE 5C.3.4: o logo aponta para o início do programa actual (/pt/).
  const { buildPath } = useProgram();
  const homeHref = buildPath('/');

  const sizes: Record<BrandLogoVariant, string> = {
    // object-contain em todos: nunca distorcer nem cortar estrela/texto.
    // FASE 5B.2: logo público com protagonismo real — 56-64px desktop, proporcional no mobile.
    public: 'h-[46px] w-auto max-w-[220px] sm:h-[58px] sm:max-w-[300px] lg:h-[64px] lg:max-w-[340px]',
    admin: 'h-9 w-auto max-w-[150px]',
    login: 'h-16 w-auto max-w-[260px] sm:h-[72px]',
    footer: 'h-12 w-auto max-w-[220px]',
  };

  const img = (
    <img
      src={src}
      alt={alt ?? brand.parentBrandAlt}
      loading={variant === 'footer' ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
      onError={() => {
        if (!disableFallback && src !== brand.logoFallbackPath) {
          setSrc(brand.logoFallbackPath);
        }
      }}
      className={cn(
        'select-none object-contain transition',
        variant === 'footer' && 'brightness-[1.02] hover:brightness-110',
        sizes[variant],
        className,
      )}
    />
  );

  if (linkToHome) {
    return (
      <Link to={homeHref} aria-label={`${brand.parentBrandName} — página inicial`} className="inline-flex shrink-0 items-center">
        {img}
      </Link>
    );
  }

  return img;
}

export default BrandLogo;
