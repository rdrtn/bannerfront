import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requirePermission } from '../auth.js';
import { buildExport, type ExportRow } from '../export.js';
import type { AppContext } from '../app.js';

export function registerExportRoutes(app: FastifyInstance, { pool, config }: AppContext): void {
  const load = async (id: string): Promise<ExportRow | null> => {
    if (!z.uuid().safeParse(id).success) return null;
    const { rows } = await pool.query<ExportRow>(
      'SELECT id, name, client, subject, media, created_at, data FROM projects WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  };
  const notFound = { error: 'not_found', message: 'Projeto não encontrado.' };

  /** Relatório de peso e avisos da versão salva, sem baixar o ZIP. */
  app.get<{ Params: { id: string } }>('/api/projects/:id/export/report', { preHandler: requirePermission('projects:read') }, async (request, reply) => {
    const row = await load(request.params.id);
    if (!row) return reply.code(404).send(notFound);
    const { report } = await buildExport(pool, config, row);
    return { report };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/export/download', { preHandler: requirePermission('projects:read') }, async (request, reply) => {
    const row = await load(request.params.id);
    if (!row) return reply.code(404).send(notFound);
    const { report, zip } = await buildExport(pool, config, row);
    if (!zip || !report.zipName) {
      return reply.code(422).send({ error: 'export_failed', message: report.errors[0] ?? 'Não foi possível exportar.', report });
    }
    await audit(pool, request.user!.id, 'project_exported', 'project', row.id, {
      zipName: report.zipName,
      totalBytes: report.totalBytes,
      overBudget: report.overBudget,
    });
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${report.zipName}.zip"`)
      .header('x-export-over-budget', String(report.overBudget))
      .send(Buffer.from(zip));
  });
}
