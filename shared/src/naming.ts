/**
 * Nomes dos ZIPs.
 *
 * - Mídia de divulgação: `mdivul_formato_cliente_diamesano`
 *   Ex.: `mdivul_bill_acso_091126`
 * - Mídia avulsa (display ou vídeo): `mavul_formato_cliente_assunto_diamesano`
 *   Ex.: `mavul_bill_acso_premio-melhores-do-ano_091126`
 *   Em dimensões livres, o formato é largura x altura (`970x250`); nos vídeos,
 *   é a abreviação do tipo (`pre15`, `dai60`...).
 *
 * A data é a de criação, no fuso de São Paulo. Os textos saem em minúsculas,
 * sem acentos, com espaços trocados por hífen.
 */

export const NAMING_TIME_ZONE = 'America/Sao_Paulo';

/** Remove acentos, passa para minúsculas e troca espaços por hífen. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `ddmmaa`, com o dia, o mês e o ano no fuso de São Paulo. */
export function formatDayMonthYear(date: Date, timeZone: string = NAMING_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}${get('month')}${get('year')}`;
}

function requireSlug(label: string, value: string): string {
  const slug = slugify(value);
  if (!slug) throw new Error(`${label} vazio: informe um valor com letras ou números.`);
  return slug;
}

export interface DivulgacaoNameInput {
  /** Abreviação do formato: `bill`, `rmd` ou `mobile`. */
  formatAbbr: string;
  client: string;
  createdAt: Date;
}

export function zipNameDivulgacao(input: DivulgacaoNameInput): string {
  return [
    'mdivul',
    requireSlug('Formato', input.formatAbbr),
    requireSlug('Cliente', input.client),
    formatDayMonthYear(input.createdAt),
  ].join('_');
}

export interface AvulsaNameInput {
  /** Abreviação do formato, tipo de vídeo ou dimensões (`970x250`). */
  formato: string;
  client: string;
  subject: string;
  createdAt: Date;
}

export function zipNameAvulsa(input: AvulsaNameInput): string {
  return [
    'mavul',
    requireSlug('Formato', input.formato),
    requireSlug('Cliente', input.client),
    requireSlug('Assunto', input.subject),
    formatDayMonthYear(input.createdAt),
  ].join('_');
}
