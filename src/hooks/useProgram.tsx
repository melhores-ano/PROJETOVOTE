/**
 * THE BEST EUROPA — FASE 5C.3.4 — Contexto central do programa actual.
 *
 * ORIGEM ÚNICA do contexto resolvido pela rota. Não criar múltiplas
 * fontes concorrentes: todos os hooks do directório leem daqui
 * (via useOptionalProgramScope) e todos os links usam buildProgramPath.
 *
 * Fail-closed: prefixo explícito sem programa activo (/fr/, /be/, /xx/)
 * → status 'invalid' → Not Found, SEM dados PT, SEM fallback Portugal.
 * Preview sem Supabase em /pt/ → modo fallback PT (dados demo locais).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import {
  resolveProgramByPrefix,
  type AwardProgramContext,
  type ProgramScope,
} from '../lib/awardProgram';
import {
  buildProgramPath,
  LEGACY_PROGRAM_PREFIX,
  normalizeRoutePrefix,
} from '../lib/programRoute';
import { supabase, usePublicQuery } from './usePublicQuery';
import { brand } from '../config/brand';

export interface ProgramContextValue extends ProgramScope {
  /** Prefixo da rota actual (ex.: 'pt'). */
  prefix: string;
  /** Constrói um caminho preservando o prefixo actual. */
  buildPath: (path: string) => string;
}

const ProgramContext = createContext<ProgramContextValue | null>(null);

/** Programa de recurso para preview sem backend (SOMENTE /pt/). */
const FALLBACK_PT_PROGRAM: AwardProgramContext = {
  id: '00000000-0000-4000-8000-00000000pt00',
  slug: 'melhores-do-ano-portugal',
  country_code: 'PT',
  locale: 'pt-PT',
  name: 'Melhores do Ano Portugal',
  active: true,
};

interface ProgramProviderProps {
  prefix: string;
  children: ReactNode;
}

export function ProgramProvider({ prefix, children }: ProgramProviderProps) {
  const clean = normalizeRoutePrefix(prefix) || LEGACY_PROGRAM_PREFIX;

  const query = usePublicQuery<AwardProgramContext | null>(async () => {
    if (!supabase) throw new Error('no-supabase');
    return await resolveProgramByPrefix(supabase, clean);
  }, null, [clean]);

  const value: ProgramContextValue = useMemo<ProgramContextValue>(() => {
    // Preview sem Supabase: /pt/ rende com fallback PT; outro prefixo
    // explícito continua inválido (fail-closed, sem dados).
    if (!supabase) {
      if (clean === LEGACY_PROGRAM_PREFIX) {
        return {
          isProgramRoute: true,
          status: 'ready',
          program: FALLBACK_PT_PROGRAM,
          prefix: clean,
          buildPath: (p: string) => buildProgramPath(clean, p),
        };
      }
      return {
        isProgramRoute: true,
        status: 'invalid',
        program: null,
        prefix: clean,
        buildPath: (p: string) => buildProgramPath(clean, p),
      };
    }
    if (query.loading) {
      return {
        isProgramRoute: true,
        status: 'loading',
        program: null,
        prefix: clean,
        buildPath: (p: string) => buildProgramPath(clean, p),
      };
    }
    if (query.data) {
      return {
        isProgramRoute: true,
        status: 'ready',
        program: query.data,
        prefix: clean,
        buildPath: (p: string) => buildProgramPath(clean, p),
      };
    }
    return {
      isProgramRoute: true,
      status: 'invalid',
      program: null,
      prefix: clean,
      buildPath: (p: string) => buildProgramPath(clean, p),
    };
  }, [clean, query.loading, query.data]);

  // Locale dinâmico da rota (preparado para futuros programas sem
  // criar traduções; Portugal mantém pt-PT).
  useEffect(() => {
    if (value.status === 'ready' && value.program) {
      document.documentElement.lang = value.program.locale || 'pt-PT';
    }
  }, [value.status, value.program]);

  return <ProgramContext.Provider value={value}>{children}</ProgramContext.Provider>;
}

/** Origem única — usar dentro de /:programPrefix. */
export function useProgram(): ProgramContextValue {
  const ctx = useContext(ProgramContext);
  if (!ctx) {
    // Resiliente fora do provider (redirects legados): prefixo PT canónico.
    return {
      isProgramRoute: false,
      status: 'outside',
      program: null,
      prefix: LEGACY_PROGRAM_PREFIX,
      buildPath: (p: string) => buildProgramPath(LEGACY_PROGRAM_PREFIX, p),
    };
  }
  return ctx;
}

/** Versão opcional para os hooks do directório (nunca rebenta). */
export function useOptionalProgramScope(): ProgramScope {
  const ctx = useContext(ProgramContext);
  if (!ctx) {
    return { isProgramRoute: false, status: 'outside', program: null };
  }
  return { isProgramRoute: ctx.isProgramRoute, status: ctx.status, program: ctx.program };
}

/** Prefixo actual ('pt'), resiliente fora do provider. */
export function useProgramPrefix(): string {
  return useProgram().prefix;
}

/** Builder de caminhos com o prefixo actual. */
export function useProgramPath(): (path: string) => string {
  return useProgram().buildPath;
}

/** Marca-mãe para cabeçalhos fora do contexto de programa. */
export function useParentBrand(): string {
  return brand.parentBrandName;
}

interface ProgramLinkProps extends Omit<LinkProps, 'to'> {
  /** Caminho relativo ao programa, ex.: '/cidades' ou 'cidade/porto'. */
  to: string;
}

/**
 * Link program-aware: prefixa automaticamente com o programa actual.
 * Usar em TODO o sítio público em vez de <Link to="/...">.
 */
export function ProgramLink({ to, ...rest }: ProgramLinkProps) {
  const { buildPath } = useProgram();
  return <Link to={buildPath(to)} {...rest} />;
}
