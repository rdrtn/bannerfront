import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';

export const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const EXTS = ['png', 'jpg', 'webp'] as const;

export const assetsDir = (config: Config, projectId: string) => path.join(config.dataDir, 'assets', projectId);

export const assetPath = (config: Config, projectId: string, assetId: string, ext: string) =>
  path.join(assetsDir(config, projectId), `${assetId}.${ext}`);

/** Acha o arquivo de uma imagem do projeto, qualquer que seja a extensão. */
export async function findAsset(
  config: Config,
  projectId: string,
  assetId: string,
): Promise<{ file: string; ext: (typeof EXTS)[number] } | null> {
  if (!ASSET_ID.test(assetId)) return null;
  for (const ext of EXTS) {
    const file = assetPath(config, projectId, assetId, ext);
    try {
      await fs.access(file);
      return { file, ext };
    } catch {
      // próxima extensão
    }
  }
  return null;
}

export const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
