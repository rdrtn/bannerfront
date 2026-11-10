
/** O que usamos de um glifo do opentype.js. */
export interface OutlineGlyph {
  index: number;
  advanceWidth?: number;
  /** Contorno em coordenadas de tela (y para baixo). */
  getPath(x: number, y: number, fontSize: number): { toPathData(decimalPlaces: number): string };
}

/**
 * O que usamos de uma fonte do opentype.js. Fica aqui como interface para o pacote
 * compartilhado não depender da biblioteca (servidor e navegador passam a fonte já lida).
 */
export interface OutlineFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  charToGlyph(char: string): OutlineGlyph;
  getKerningValue(left: OutlineGlyph, right: OutlineGlyph): number;
  position?: {
    getDefaultScriptName(): string;
    getKerningTables(script: string, language?: string): unknown;
    getKerningValue(lookups: unknown, left: number, right: number): number;
  };
}

export interface TextStyle {
  fontSize: number;
  lineHeight: number;
  /** Em pixels, entre as letras. */
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
}

export interface TextLine {
  text: string;
  x: number;
  baseline: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  /** Altura total ocupada pelas linhas. */
  height: number;
  /** Maior largura entre as linhas. */
  width: number;
}

class Measurer {
  private lookups: unknown = null;
  private readonly scale: number;

  constructor(
    private readonly font: OutlineFont,
    private readonly style: TextStyle,
  ) {
    this.scale = style.fontSize / font.unitsPerEm;
    try {
      const pos = font.position;
      if (pos) this.lookups = pos.getKerningTables(pos.getDefaultScriptName());
    } catch {
      this.lookups = null;
    }
  }

  private kern(a: OutlineGlyph, b: OutlineGlyph): number {
    try {
      const pos = this.font.position;
      if (pos && this.lookups) return pos.getKerningValue(this.lookups, a.index, b.index) || 0;
      return this.font.getKerningValue(a, b) || 0;
    } catch {
      return 0;
    }
  }

  /** Posições de cada letra e largura (sem o espaçamento depois da última letra). */
  place(text: string): { glyphs: { glyph: OutlineGlyph; x: number }[]; width: number } {
    // Não usamos stringToGlyphs do opentype.js: ele falha em fontes comuns do Google Fonts
    // (tabelas GSUB que não suporta). Sem ligaduras, mas com kerning.
    const chars = Array.from(text);
    const glyphs: { glyph: OutlineGlyph; x: number }[] = [];
    let x = 0;
    let prev: OutlineGlyph | null = null;
    for (const char of chars) {
      const glyph = this.font.charToGlyph(char);
      if (prev) x += this.kern(prev, glyph) * this.scale + this.style.letterSpacing;
      glyphs.push({ glyph, x });
      x += (glyph.advanceWidth ?? 0) * this.scale;
      prev = glyph;
    }
    return { glyphs, width: x };
  }

  width(text: string): number {
    return this.place(text).width;
  }
}

/** Quebra o texto em linhas (por \n e por largura) e posiciona cada uma. */
export function layoutText(font: OutlineFont, text: string, boxWidth: number, style: TextStyle): TextLayout {
  const m = new Measurer(font, style);
  const lines: string[] = [];

  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0]!;
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (m.width(candidate) <= boxWidth) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  const scale = style.fontSize / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const descent = -font.descender * scale;
  const lineBox = style.fontSize * style.lineHeight;
  const baselineInLine = (lineBox - (ascent + descent)) / 2 + ascent;

  let maxWidth = 0;
  const placed = lines.map((line, i): TextLine => {
    const width = m.width(line);
    maxWidth = Math.max(maxWidth, width);
    const x = style.align === 'left' ? 0 : style.align === 'center' ? (boxWidth - width) / 2 : boxWidth - width;
    return { text: line, x, baseline: i * lineBox + baselineInLine, width };
  });

  return { lines: placed, height: lines.length * lineBox, width: maxWidth };
}

/** Dados do path SVG com o contorno de todas as linhas. */
export function textPathData(font: OutlineFont, layout: TextLayout, style: TextStyle): string {
  const m = new Measurer(font, style);
  const parts: string[] = [];
  for (const line of layout.lines) {
    if (!line.text) continue;
    for (const { glyph, x } of m.place(line.text).glyphs) {
      const d = glyph.getPath(line.x + x, line.baseline, style.fontSize).toPathData(1);
      if (d) parts.push(d);
    }
  }
  return parts.join('');
}

