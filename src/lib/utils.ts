import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Normaliza texto para pesquisa (minúsculas, sem acentos). */
export function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Gera um slug URL-friendly a partir de um nome. */
export function slugify(str: string): string {
  return normalize(str)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

export function formatDatePt(dateIso: string | null): string {
  if (!dateIso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-PT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(dateIso));
  } catch {
    return '—';
  }
}
