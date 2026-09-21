/**
 * Prémios Melhores do Ano Portugal — Phase 3
 * Utilitários de importação CSV (bulk onboarding de negócios).
 * Colunas esperadas: business_name, city, category, description, website,
 * instagram, facebook, google_maps_url, phone, email, address.
 */
import { normalize, slugify } from './utils';

export const CSV_HEADERS = [
  'business_name',
  'city',
  'category',
  'description',
  'website',
  'instagram',
  'facebook',
  'google_maps_url',
  'phone',
  'email',
  'address',
] as const;

export type CsvHeader = (typeof CSV_HEADERS)[number];

export interface CsvRowRaw {
  line: number;
  values: Record<string, string>;
}

export interface CsvRowValidated {
  line: number;
  values: Record<string, string>;
  slug: string;
  errors: string[];
  warnings: string[];
  duplicateKey: string;
  isDuplicateInFile: boolean;
}

/** Parser CSV mínimo mas correcto: aspas, vírgulas, ponto-e-vírgula e \n. */
export function parseCsv(text: string): { headers: string[]; rows: CsvRowRaw[]; delimiter: string } {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], delimiter: ',' };
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());
  const rows: CsvRowRaw[] = lines.slice(1).map((line, i) => {
    const cells = splitLine(line, delimiter);
    const values: Record<string, string> = {};
    headers.forEach((h, idx) => {
      values[h] = (cells[idx] ?? '').trim();
    });
    return { line: i + 2, values };
  });
  return { headers, rows, delimiter };
}

function detectDelimiter(header: string): string {
  const semis = (header.match(/;/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((c) => c.replace(/^"|"$/g, ''));
}

function isUrl(v: string): boolean {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isEmail(v: string): boolean {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function validateRows(
  rows: CsvRowRaw[],
  opts: { existingSlugs: Set<string>; cityNames: Map<string, string>; categoryNames: Map<string, string> },
): CsvRowValidated[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const v = r.values;
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = (v.business_name ?? '').trim();
    const city = (v.city ?? '').trim();
    const category = (v.category ?? '').trim();
    if (!name) errors.push('business_name é obrigatório.');
    if (!city) errors.push('city é obrigatória.');
    if (!category) errors.push('category é obrigatória.');
    const slug = name ? slugify(name) : '';
    if (name && (slug.length < 2 || slug.length > 120)) errors.push('Nome gera um slug inválido.');
    if (city && !opts.cityNames.has(normalize(city))) warnings.push(`Cidade «${city}» não existe — será sugerida criação ou correspondência.`);
    if (category && !opts.categoryNames.has(normalize(category))) warnings.push(`Categoria «${category}» não existe — será sugerida criação ou correspondência.`);
    if (!isEmail(v.email ?? '')) errors.push('Email inválido.');
    if (!isUrl(v.website ?? '')) errors.push('Website inválido (use https://…).');
    if (!isUrl(v.instagram ?? '')) errors.push('Instagram inválido (use https://…).');
    if (!isUrl(v.facebook ?? '')) errors.push('Facebook inválido (use https://…).');
    if (!isUrl(v.google_maps_url ?? '')) errors.push('google_maps_url inválido (use https://…).');
    const duplicateKey = `${slug}::${normalize(city)}`;
    const prev = seen.get(duplicateKey);
    const isDuplicateInFile = prev !== undefined;
    if (isDuplicateInFile) errors.push(`Duplicado no ficheiro (linha ${prev}).`);
    else seen.set(duplicateKey, r.line);
    if (slug && opts.existingSlugs.has(slug)) warnings.push('Já existe um negócio com este slug — será actualizado em vez de duplicado.');
    return { line: r.line, values: v, slug, errors, warnings, duplicateKey, isDuplicateInFile };
  });
}

export const CSV_TEMPLATE = [
  CSV_HEADERS.join(','),
  '"Barbearia do Largo",Braga,Barbearias,"Barbearia clássica no centro de Braga",https://exemplo.pt,https://instagram.com/exemplo,https://facebook.com/exemplo,https://maps.google.com/?q=exemplo,+351 253 000 000,geral@exemplo.pt,"Rua do Largo 1, Braga"',
].join('\n');
