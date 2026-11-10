import sharp, { type Metadata } from 'sharp';

export type StoredImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageInfo {
  mimeType: StoredImageType;
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
}

export class ImageError extends Error {}

const MAX_SIDE = 8000;

/** Valida o arquivo enviado (PNG, JPG ou WebP) e lê as dimensões já com a rotação EXIF aplicada. */
export async function inspectImage(buf: Buffer): Promise<ImageInfo> {
  let meta: Metadata;
  try {
    meta = await sharp(buf, { failOn: 'error' }).metadata();
  } catch {
    throw new ImageError('Não foi possível ler a imagem. Envie PNG, JPG ou WebP.');
  }
  const kinds: Record<string, Pick<ImageInfo, 'mimeType' | 'ext'>> = {
    png: { mimeType: 'image/png', ext: 'png' },
    jpeg: { mimeType: 'image/jpeg', ext: 'jpg' },
    webp: { mimeType: 'image/webp', ext: 'webp' },
  };
  const kind = meta.format ? kinds[meta.format] : undefined;
  if (!kind) throw new ImageError('Formato de imagem não suportado. Envie PNG, JPG ou WebP.');
  if ((meta.pages ?? 1) > 1) throw new ImageError('WebP animado não é suportado.');

  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  if (!width || !height) throw new ImageError('Imagem sem dimensões válidas.');
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new ImageError(`A imagem é grande demais (${width}x${height}). O máximo é ${MAX_SIDE}x${MAX_SIDE}.`);
  }
  return { ...kind, width, height };
}

export interface ImageUse {
  width: number;
  height: number;
  fit: 'cover' | 'contain' | 'fill';
  focus: { x: number; y: number };
}

export interface OptimizedImage {
  data: Buffer;
  ext: 'jpg' | 'png';
}

/**
 * Prepara a imagem para o banner: reduz ao tamanho em que ela aparece (sem ampliar),
 * recorta em volta do ponto de foco quando é a foto principal (cover, um uso só)
 * e recomprime. `quality` vai de 1 a 100.
 */
export async function optimizeImage(source: Buffer, uses: ImageUse[], quality: number): Promise<OptimizedImage> {
  const oriented = sharp(source, { failOn: 'none' }).rotate();
  const { data: base, info } = await oriented.toBuffer({ resolveWithObject: true });
  const iw = info.width;
  const ih = info.height;

  // Escala necessária: a maior entre os usos (nunca amplia).
  let need = 0;
  for (const use of uses) {
    const sx = use.width / iw;
    const sy = use.height / ih;
    need = Math.max(need, use.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy));
  }
  const scale = Math.min(1, need || 1);
  const rw = Math.max(1, Math.round(iw * scale));
  const rh = Math.max(1, Math.round(ih * scale));

  let pipeline = sharp(base).toColorspace('srgb');
  if (scale < 1) pipeline = pipeline.resize(rw, rh, { fit: 'fill', kernel: 'lanczos3' });

  const only = uses.length === 1 ? uses[0]! : null;
  if (only && only.fit === 'cover') {
    const boxW = Math.round(only.width);
    const boxH = Math.round(only.height);
    if (rw >= boxW && rh >= boxH && (rw > boxW || rh > boxH)) {
      const left = Math.min(rw - boxW, Math.max(0, Math.round((rw - boxW) * only.focus.x)));
      const top = Math.min(rh - boxH, Math.max(0, Math.round((rh - boxH) * only.focus.y)));
      pipeline = sharp(await pipeline.png().toBuffer()).extract({ left, top, width: boxW, height: boxH });
    }
  }
  const prepared = await pipeline.png().toBuffer();

  const wasJpeg = info.format === 'jpeg';
  let usesAlpha = false;
  if (!wasJpeg && info.channels === 4) {
    const stats = await sharp(prepared).stats();
    const alpha = stats.channels[3];
    usesAlpha = !!alpha && alpha.min < 255;
  }

  const asJpeg = () =>
    sharp(prepared).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
  const asPng = () =>
    sharp(prepared).png({ palette: true, quality, effort: 10, compressionLevel: 9 }).toBuffer();

  if (usesAlpha) return { data: await asPng(), ext: 'png' };
  if (wasJpeg) return { data: await asJpeg(), ext: 'jpg' };
  // PNG/WebP sem transparência: vale o menor entre os dois.
  const [jpeg, png] = await Promise.all([asJpeg(), asPng()]);
  return png.length <= jpeg.length ? { data: png, ext: 'png' } : { data: jpeg, ext: 'jpg' };
}
