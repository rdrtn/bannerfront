/** Número curto para CSS/SVG: no máximo 2 casas e sem zeros à direita. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Percentual de keyframe com até 4 casas. */
export function pct(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  return `${rounded}%`;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ParsedColor {
  /** #rrggbb */
  hex: string;
  /** 0 a 1 */
  alpha: number;
}

/** Aceita #rrggbb e #rrggbbaa. */
export function parseColor(color: string): ParsedColor {
  const hex = color.slice(0, 7).toLowerCase();
  const alpha = color.length === 9 ? Math.round((parseInt(color.slice(7, 9), 16) / 255) * 1000) / 1000 : 1;
  return { hex, alpha };
}

/** Atributos SVG de preenchimento: fill + fill-opacity (compatível com qualquer navegador). */
export function svgPaint(attr: 'fill' | 'stroke', color: string | null): string {
  if (color === null) return ` ${attr}="none"`;
  const { hex, alpha } = parseColor(color);
  return ` ${attr}="${hex}"${alpha < 1 ? ` ${attr}-opacity="${num(alpha)}"` : ''}`;
}
