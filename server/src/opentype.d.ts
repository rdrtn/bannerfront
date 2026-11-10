// opentype.js 2.x não traz tipos próprios; declaramos só o que usamos.
declare module 'opentype.js' {
  type LocalizedNames = Record<string, Record<string, string>>;

  interface Os2Table {
    usWeightClass?: number;
    fsType?: number;
    fsSelection?: number;
  }

  export interface Font {
    names: {
      windows?: LocalizedNames;
      macintosh?: LocalizedNames;
      unicode?: LocalizedNames;
    };
    unitsPerEm: number;
    numGlyphs: number;
    outlinesFormat: string;
    tables: { os2?: Os2Table } & Record<string, unknown>;
  }

  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): Font;
}
