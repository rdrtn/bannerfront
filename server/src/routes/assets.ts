import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../auth.js';
import { ImageError, inspectImage } from '../images.js';
import { assetPath, assetsDir, findAsset, MIME_BY_EXT } from '../storage.js';
import type { AppContext } from '../app.js';

export function registerAssetRoutes(app: FastifyInstance, { pool, config }: AppContext): void {
  const notFound = { error: 'not_found', message: 'Projeto não encontrado.' };

  /** Envia uma imagem para o projeto. Devolve o registro para o cliente colocar em `assets` ao salvar. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/assets', { preHandler: requirePermission('projects:write') }, async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(404).send(notFound);
    const exists = await pool.query('SELECT 1 FROM projects WHERE id = $1', [request.params.id]);
    if (!exists.rowCount) return reply.code(404).send(notFound);
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Envie a imagem como multipart/form-data.' });
    }

    let upload: { name: string; data: Buffer } | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file' && !upload) {
        upload = { name: part.filename || 'imagem', data: await part.toBuffer() };
      } else if (part.type === 'file') {
        await part.toBuffer();
      }
    }
    if (!upload) return reply.code(400).send({ error: 'invalid_request', message: 'Selecione uma imagem.' });
    if (upload.data.length > config.maxImageBytes) {
      return reply.code(413).send({ error: 'file_too_large', message: `A imagem passa de ${Math.round(config.maxImageBytes / 1_000_000)} MB.` });
    }

    let info;
    try {
      info = await inspectImage(upload.data);
    } catch (err) {
      if (err instanceof ImageError) return reply.code(422).send({ error: 'invalid_image', message: err.message });
      throw err;
    }

    const assetId = `a${randomBytes(5).toString('hex')}`;
    await fs.mkdir(assetsDir(config, request.params.id), { recursive: true });
    await fs.writeFile(assetPath(config, request.params.id, assetId, info.ext), upload.data);

    return reply.code(201).send({
      assetId,
      asset: {
        kind: 'image',
        fileName: upload.name.slice(0, 255),
        mimeType: info.mimeType,
        width: info.width,
        height: info.height,
        bytes: upload.data.length,
      },
    });
  });

  app.get<{ Params: { id: string; assetId: string } }>(
    '/api/projects/:id/assets/:assetId',
    { preHandler: requirePermission('projects:read') },
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.id).success) return reply.code(404).send(notFound);
      const found = await findAsset(config, request.params.id, request.params.assetId);
      if (!found) return reply.code(404).send({ error: 'not_found', message: 'Imagem não encontrada.' });
      return reply
        .header('content-type', MIME_BY_EXT[found.ext])
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(await fs.readFile(found.file));
    },
  );
}
