// opentype.js 2.x não traz tipos próprios; declaramos só o que usamos.
declare module 'opentype.js' {
  type LocalizedNames = Record<string, Record<string, string>>;

  interface Os2Table {
    usWeightClass?: number;
    fsType?: number;
    fsSelection?: number;
  }

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): { toPathData(decimalPlaces: number): string };
  }

  export interface Font {
    names: {
      windows?: LocalizedNames;
      macintosh?: LocalizedNames;
      unicode?: LocalizedNames;
    };
    unitsPerEm: number;
    ascender: number;
    descender: number;
    numGlyphs: number;
    outlinesFormat: string;
    tables: { os2?: Os2Table } & Record<string, unknown>;
    charToGlyph(char: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
    position?: {
      getDefaultScriptName(): string;
      getKerningTables(script: string, language?: string): unknown;
      getKerningValue(lookups: unknown, left: number, right: number): number;
    };
  }

  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): Font;
}
