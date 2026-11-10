/**
 * Formatos de display ads e de vídeo do Bannerfront.
 *
 * Os pesos máximos valem para o conteúdo inteiro do ZIP, SEM compressão
 * (soma dos tamanhos dos arquivos). Aqui 1 KB = 1000 bytes e 1 MB = 1.000.000
 * bytes, a leitura mais conservadora: o validador nunca aprova um arquivo que
 * passaria só com 1 KB = 1024 bytes. Se o Ad Manager usar 1024, basta mudar
 * as duas constantes abaixo.
 */
export const KB = 1000;
export const MB = 1000 * 1000;

export interface DisplayFormat {
  id: string;
  label: string;
  /** Abreviação usada no nome dos ZIPs. */
  abbr: string;
  width: number;
  height: number;
  /** Peso máximo do conteúdo do ZIP, sem compressão, em bytes. */
  maxBytes: number;
}

export const DISPLAY_FORMATS: readonly DisplayFormat[] = [
  { id: 'billboard', label: 'Billboard', abbr: 'bill', width: 970, height: 250, maxBytes: 250 * KB },
  { id: 'retangulo-medio', label: 'Retângulo Médio', abbr: 'rmd', width: 300, height: 250, maxBytes: 150 * KB },
  { id: 'maxiboard', label: 'Maxiboard', abbr: 'maxi', width: 970, height: 150, maxBytes: 200 * KB },
  { id: 'banner-meia-pagina', label: 'Banner Meia Página', abbr: 'bmp', width: 300, height: 600, maxBytes: 250 * KB },
  { id: 'super-leaderboard', label: 'Super Leaderboard', abbr: 'slb', width: 970, height: 90, maxBytes: 350 * KB },
  { id: 'mobile', label: 'Mobile', abbr: 'mobile', width: 320, height: 100, maxBytes: 100 * KB },
] as const;

/** Os três formatos de uma mídia de divulgação. */
export const DIVULGACAO_FORMAT_IDS = ['billboard', 'retangulo-medio', 'mobile'] as const;

/** Mídia avulsa em dimensões livres. */
export const CUSTOM_FORMAT_ID = 'custom';
export const CUSTOM_MAX_BYTES = 10 * MB;
export const CUSTOM_MIN_SIZE = 16;
export const CUSTOM_MAX_SIZE = 4096;

export function findFormat(id: string | null | undefined): DisplayFormat | undefined {
  return DISPLAY_FORMATS.find((f) => f.id === id);
}

export function findFormatByAbbr(abbr: string): DisplayFormat | undefined {
  return DISPLAY_FORMATS.find((f) => f.abbr === abbr);
}

/** Peso máximo, em bytes, para um formato conhecido ou para dimensões livres. */
export function maxBytesFor(formatId: string | null | undefined): number {
  return findFormat(formatId)?.maxBytes ?? CUSTOM_MAX_BYTES;
}

/** Texto de formato para dimensões livres, como `970x250`. */
export function dimensionsLabel(width: number, height: number): string {
  return `${width}x${height}`;
}

// ---------------------------------------------------------------------------
// Vídeo
// ---------------------------------------------------------------------------

/** 29,97 fps (NTSC), como fração exata. */
export const VIDEO_FPS = { numerator: 30000, denominator: 1001 } as const;
export const VIDEO_FPS_VALUE = VIDEO_FPS.numerator / VIDEO_FPS.denominator;

/** O vídeo só é gerado quando a animação está em uma destas dimensões. */
export const VIDEO_SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

export function isVideoSize(width: number, height: number): boolean {
  return VIDEO_SIZES.some((s) => s.width === width && s.height === height);
}

export interface VideoType {
  /** PROVISÓRIO: as abreviações dos vídeos ainda aguardam confirmação. */
  id: string;
  label: string;
  minSeconds: number;
  maxSeconds: number;
}

export const VIDEO_TYPES: readonly VideoType[] = [
  { id: 'pre15', label: 'Pré Roll 15" Sem Skip', minSeconds: 15, maxSeconds: 15 },
  { id: 'bumper6', label: 'Bumper AD 6" Sem Skip', minSeconds: 6, maxSeconds: 6 },
  { id: 'preskip', label: 'Pré Roll 30" a 180" Com Skip', minSeconds: 30, maxSeconds: 180 },
  { id: 'dai60', label: 'Globo DAI 60"', minSeconds: 60, maxSeconds: 60 },
  { id: 'dai45', label: 'Globo DAI 45"', minSeconds: 45, maxSeconds: 45 },
  { id: 'dai30', label: 'Globo DAI 30" ou 20"', minSeconds: 20, maxSeconds: 30 },
  { id: 'dai15', label: 'Globo DAI 15"', minSeconds: 15, maxSeconds: 15 },
  { id: 'dai6', label: 'Globo DAI 6" ou 5"', minSeconds: 5, maxSeconds: 6 },
] as const;

export function findVideoType(id: string): VideoType | undefined {
  return VIDEO_TYPES.find((t) => t.id === id);
}
