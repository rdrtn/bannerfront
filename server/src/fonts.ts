import { createHash } from 'node:crypto';
import * as opentype from 'opentype.js';

export type FontFormat = 'ttf' | 'otf' | 'woff';

export interface FontInfo {
  format: FontFormat;
  family: string;
  style: string;
  weight: number;
  italic: boolean;
  glyphCount: number;
  sha256: string;
  bytes: number;
}

export class FontError extends Error {}

/** Identifica o formato pelos primeiros bytes (a extensão do arquivo não é confiável). */
export function sniffFontFormat(buf: Buffer): FontFormat {
  if (buf.length < 12) throw new FontError('Arquivo pequeno demais para ser uma fonte.');
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'wOF2') throw new FontError('WOFF2 não é suportado. Envie TTF, OTF ou WOFF.');
  if (tag === 'ttcf') throw new FontError('Coleções de fontes (.ttc) não são suportadas. Envie um arquivo por estilo.');
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf';
  if (buf.readUInt32BE(0) === 0x00010000 || tag === 'true') return 'ttf';
  throw new FontError('O arquivo não parece ser uma fonte TTF, OTF ou WOFF.');
}

type LocalizedNames = Record<string, Record<string, string>> | undefined;

function pickName(font: opentype.Font, ...keys: string[]): string | undefined {
  const tables: LocalizedNames[] = [font.names.windows, font.names.macintosh, font.names.unicode];
  for (const key of keys) {
    for (const table of tables) {
      const entry = table?.[key];
      const value = entry?.en ?? (entry ? Object.values(entry)[0] : undefined);
      if (value?.trim()) return value.trim();
    }
  }
  return undefined;
}

/** Valida o arquivo e extrai os metadados. Lança FontError com mensagem em português. */
export function inspectFont(buf: Buffer): FontInfo {
  const format = sniffFontFormat(buf);

  let font: opentype.Font;
  try {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    font = opentype.parse(ab);
  } catch {
    throw new FontError('Não foi possível ler a fonte. O arquivo pode estar corrompido.');
  }

  if (!font.numGlyphs || !font.unitsPerEm) throw new FontError('A fonte não tem glifos utilizáveis.');

  // fsType bit 1 (0x0002): "Restricted License embedding" — o autor proíbe incorporar a fonte.
  const fsType = font.tables.os2?.fsType ?? 0;
  if ((fsType & 0x000f) === 0x0002) {
    throw new FontError('A licença desta fonte proíbe a incorporação (fsType restrito), então ela não pode ser usada em banners.');
  }

  const family = pickName(font, 'preferredFamily', 'fontFamily');
  if (!family) throw new FontError('A fonte não informa o nome da família.');
  const style = pickName(font, 'preferredSubfamily', 'fontSubfamily') ?? 'Regular';

  const fsSelection = font.tables.os2?.fsSelection ?? 0;
  const italic = (fsSelection & 0x01) !== 0 || /italic|oblique|itálic/i.test(style);
  const weight = font.tables.os2?.usWeightClass ?? (/bold/i.test(style) ? 700 : 400);

  return {
    format,
    family,
    style,
    weight,
    italic,
    glyphCount: font.numGlyphs,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  };
}

export const FONT_MIME: Record<FontFormat, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
};
