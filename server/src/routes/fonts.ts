import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requirePermission } from '../auth.js';
import { FONT_MIME, FontError, inspectFont, type FontFormat } from '../fonts.js';
import type { AppContext } from '../app.js';

interface FontRow {
  id: string;
  family: string;
  style: string;
  weight: number;
  italic: boolean;
  format: FontFormat;
  file_name: string;
  sha256: string;
  bytes: number;
  glyph_count: number;
  source: string;
  license_confirmed: boolean;
  created_at: Date;
}

const COLUMNS =
  'id, family, style, weight, italic, format, file_name, sha256, bytes, glyph_count, source, license_confirmed, created_at';

const toApi = (f: FontRow) => ({
  id: f.id,
  family: f.family,
  style: f.style,
  weight: f.weight,
  italic: f.italic,
  format: f.format,
  fileName: f.file_name,
  bytes: f.bytes,
  glyphCount: f.glyph_count,
  source: f.source,
  createdAt: f.created_at.toISOString(),
});

export const fontsDir = (dataDir: string) => path.join(dataDir, 'fonts');
export const fontFilePath = (dataDir: string, f: Pick<FontRow, 'sha256' | 'format'>) =>
  path.join(fontsDir(dataDir), `${f.sha256}.${f.format}`);

export function registerFontRoutes(app: FastifyInstance, { pool, config }: AppContext): void {
  app.get('/api/fonts', { preHandler: requirePermission('fonts:read') }, async () => {
    const { rows } = await pool.query<FontRow>(`SELECT ${COLUMNS} FROM fonts ORDER BY lower(family), weight, italic`);
    return { fonts: rows.map(toApi) };
  });

  app.get<{ Params: { id: string } }>('/api/fonts/:id/file', { preHandler: requirePermission('fonts:read') }, async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(404).send({ error: 'not_found', message: 'Fonte não encontrada.' });
    const { rows } = await pool.query<FontRow>(`SELECT ${COLUMNS} FROM fonts WHERE id = $1`, [request.params.id]);
    const font = rows[0];
    if (!font) return reply.code(404).send({ error: 'not_found', message: 'Fonte não encontrada.' });
    const data = await fs.readFile(fontFilePath(config.dataDir, font));
    return reply
      .header('content-type', FONT_MIME[font.format])
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(data);
  });

  app.post('/api/fonts', { preHandler: requirePermission('fonts:upload') }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Envie o arquivo como multipart/form-data.' });
    }

    let file: { name: string; data: Buffer } | null = null;
    const fields: Record<string, string> = {};
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') {
          await part.toBuffer(); // consome e descarta
          continue;
        }
        const data = await part.toBuffer(); // lança se passar do limite
        file = { name: part.filename || 'fonte', data };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }

    if (!file) return reply.code(400).send({ error: 'invalid_request', message: 'Selecione um arquivo de fonte.' });
    if (fields.licenseConfirmed !== 'true') {
      return reply.code(400).send({ error: 'license_required', message: 'Confirme que você tem licença para usar esta fonte.' });
    }
    let info;
    try {
      info = inspectFont(file.data);
    } catch (err) {
      if (err instanceof FontError) return reply.code(422).send({ error: 'invalid_font', message: err.message });
      throw err;
    }

    const duplicate = await pool.query<FontRow>(`SELECT ${COLUMNS} FROM fonts WHERE sha256 = $1`, [info.sha256]);
    if (duplicate.rows[0]) {
      return reply.code(409).send({
        error: 'duplicate_font',
        message: `Esta fonte já está cadastrada (${duplicate.rows[0].family} ${duplicate.rows[0].style}).`,
        font: toApi(duplicate.rows[0]),
      });
    }

    const target = fontFilePath(config.dataDir, info);
    await fs.mkdir(fontsDir(config.dataDir), { recursive: true });
    await fs.writeFile(target, file.data);

    try {
      const { rows } = await pool.query<FontRow>(
        `INSERT INTO fonts (family, style, weight, italic, format, file_name, sha256, bytes, glyph_count,
                            source, license_confirmed, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'upload', true, $10)
         RETURNING ${COLUMNS}`,
        [
          info.family,
          info.style,
          info.weight,
          info.italic,
          info.format,
          file.name.slice(0, 200),
          info.sha256,
          info.bytes,
          info.glyphCount,
          request.user!.id,
        ],
      );
      await audit(pool, request.user!.id, 'font_uploaded', 'font', rows[0]!.id, {
        family: info.family,
        style: info.style,
      });
      return reply.code(201).send({ font: toApi(rows[0]!) });
    } catch (err) {
      await fs.rm(target, { force: true });
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'duplicate_font', message: 'Esta fonte já está cadastrada.' });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/fonts/:id', { preHandler: requirePermission('system:manage') }, async (request, reply) => {
    const { id } = request.params;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'Fonte não encontrada.' });

    const { rows } = await pool.query<FontRow>(`SELECT ${COLUMNS} FROM fonts WHERE id = $1`, [id]);
    const font = rows[0];
    if (!font) return reply.code(404).send({ error: 'not_found', message: 'Fonte não encontrada.' });

    const inUse = await pool.query<{ name: string }>(
      `SELECT name FROM projects WHERE position($1 in data::text) > 0 LIMIT 5`,
      [`"${id}"`],
    );
    if (inUse.rows.length > 0) {
      return reply.code(409).send({
        error: 'font_in_use',
        message: `A fonte está em uso por: ${inUse.rows.map((r) => r.name).join(', ')}.`,
      });
    }

    await pool.query('DELETE FROM fonts WHERE id = $1', [id]);
    await fs.rm(fontFilePath(config.dataDir, font), { force: true });
    await audit(pool, request.user!.id, 'font_deleted', 'font', id, { family: font.family, style: font.style });
    return reply.code(204).send();
  });
}
