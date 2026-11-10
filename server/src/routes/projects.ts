import {
  checkProject,
  DIVULGACAO_FORMAT_IDS,
  createEmptyProject,
  CUSTOM_FORMAT_ID,
  CUSTOM_MAX_SIZE,
  CUSTOM_MIN_SIZE,
  findFormat,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  projectDocumentSchema,
} from '@bannerfront/shared';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { audit, requirePermission } from '../auth.js';
import { assetsDir } from '../storage.js';
import type { AppContext } from '../app.js';

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : null));

const createBody = z.object({
  name: z.string().trim().min(1, 'Informe o nome do projeto.').max(160),
  media: z.enum(['divulgacao', 'avulsa']).default('avulsa'),
  client: z.string().trim().min(1, 'Informe o cliente.').max(120),
  subject: optionalText,
  kind: z.enum(['basic', 'advanced']),
  formatId: z.string().min(1),
  width: z.number().int().min(CUSTOM_MIN_SIZE).max(CUSTOM_MAX_SIZE).optional(),
  height: z.number().int().min(CUSTOM_MIN_SIZE).max(CUSTOM_MAX_SIZE).optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  client: optionalText,
  subject: optionalText,
  version: z.number().int().positive(),
  document: z.unknown(),
});

const listQuery = z.object({
  kind: z.enum(['basic', 'advanced']).optional(),
  q: z.string().trim().max(100).optional(),
});

interface ProjectRow {
  id: string;
  name: string;
  client: string | null;
  subject: string | null;
  media: string;
  kind: string;
  format_id: string;
  width: number;
  height: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  data?: unknown;
}

const summary = (r: ProjectRow) => ({
  id: r.id,
  name: r.name,
  client: r.client,
  subject: r.subject,
  media: r.media,
  kind: r.kind,
  formatId: r.format_id,
  width: r.width,
  height: r.height,
  version: r.version,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SUMMARY_COLUMNS = 'id, name, client, subject, media, kind, format_id, width, height, version, created_at, updated_at';

export function registerProjectRoutes(app: FastifyInstance, { pool, config }: AppContext): void {
  const notFound = { error: 'not_found', message: 'Projeto não encontrado.' };
  const validId = (id: string) => z.uuid().safeParse(id).success;

  app.get('/api/projects', { preHandler: requirePermission('projects:read') }, async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request', message: 'Filtro inválido.' });

    const where: string[] = [];
    const params: unknown[] = [];
    if (query.data.kind) {
      params.push(query.data.kind);
      where.push(`kind = $${params.length}`);
    }
    if (query.data.q) {
      params.push(`%${query.data.q.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(name ILIKE $${params.length} OR client ILIKE $${params.length} OR subject ILIKE $${params.length})`);
    }
    const { rows } = await pool.query<ProjectRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY updated_at DESC LIMIT 500`,
      params,
    );
    return { projects: rows.map(summary) };
  });

  app.post('/api/projects', { preHandler: requirePermission('projects:write') }, async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Dados inválidos.' });
    }
    const { formatId, width, height, media } = body.data;
    if (media === 'divulgacao') {
      if (!(DIVULGACAO_FORMAT_IDS as readonly string[]).includes(formatId)) {
        return reply.code(400).send({ error: 'invalid_request', message: 'A mídia de divulgação usa Billboard, Retângulo Médio ou Mobile.' });
      }
      if (body.data.subject) {
        return reply.code(400).send({ error: 'invalid_request', message: 'O assunto existe só na mídia avulsa.' });
      }
    } else if (!body.data.subject) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Informe o assunto da mídia avulsa.' });
    }
    if (formatId !== CUSTOM_FORMAT_ID && !findFormat(formatId)) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Formato desconhecido.' });
    }
    if (formatId === CUSTOM_FORMAT_ID && (!width || !height)) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Informe largura e altura para dimensões livres.' });
    }

    const doc = createEmptyProject({ kind: body.data.kind, formatId, width, height });
    const { rows } = await pool.query<ProjectRow>(
      `INSERT INTO projects (name, client, subject, media, kind, format_id, width, height, schema_version, data, created_by, updated_by)
       VALUES ($1, $2, $3, $11, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING ${SUMMARY_COLUMNS}`,
      [
        body.data.name,
        body.data.client,
        body.data.subject,
        doc.kind,
        doc.formatId,
        doc.canvas.width,
        doc.canvas.height,
        PROJECT_SCHEMA_VERSION,
        JSON.stringify(doc),
        request.user!.id,
        media,
      ],
    );
    await audit(pool, request.user!.id, 'project_created', 'project', rows[0]!.id, { kind: doc.kind, formatId });
    return reply.code(201).send({ project: summary(rows[0]!), document: doc, issues: checkProject(doc) });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', { preHandler: requirePermission('projects:read') }, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send(notFound);
    const { rows } = await pool.query<ProjectRow>(`SELECT ${SUMMARY_COLUMNS}, data FROM projects WHERE id = $1`, [request.params.id]);
    const row = rows[0];
    if (!row) return reply.code(404).send(notFound);

    // Projetos antigos são migrados na leitura; a gravação seguinte já salva no formato atual.
    const document = projectDocumentSchema.parse(migrateProject(row.data));
    return { project: summary(row), document, issues: checkProject(document) };
  });

  app.put<{ Params: { id: string } }>('/api/projects/:id', { preHandler: requirePermission('projects:write') }, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send(notFound);
    const body = updateBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Dados inválidos.' });
    }

    let document;
    try {
      document = projectDocumentSchema.parse(migrateProject(body.data.document));
    } catch (err) {
      const issue = err instanceof z.ZodError ? err.issues[0] : undefined;
      return reply.code(422).send({
        error: 'invalid_document',
        message: 'O projeto enviado é inválido.',
        details: issue ? `${issue.path.join('.')}: ${issue.message}` : undefined,
      });
    }
    const issues = checkProject(document);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      return reply.code(422).send({ error: 'invalid_document', message: 'O projeto tem erros.', issues: errors });
    }

    // O formato e o tamanho do canvas não mudam depois de criado.
    const { rows: existing } = await pool.query<ProjectRow>('SELECT kind, format_id, width, height FROM projects WHERE id = $1', [
      request.params.id,
    ]);
    const current = existing[0];
    if (!current) return reply.code(404).send(notFound);
    if (
      current.kind !== document.kind ||
      current.format_id !== document.formatId ||
      current.width !== document.canvas.width ||
      current.height !== document.canvas.height
    ) {
      return reply.code(422).send({
        error: 'immutable_canvas',
        message: 'Tipo, formato e dimensões do projeto não podem ser alterados depois de criado.',
      });
    }

    const { rows } = await pool.query<ProjectRow>(
      `UPDATE projects
          SET name = coalesce($3, name),
              client = CASE WHEN $4::boolean THEN $5 ELSE client END,
              subject = CASE WHEN $6::boolean THEN $7 ELSE subject END,
              data = $8, schema_version = $9, version = version + 1,
              updated_by = $10, updated_at = now()
        WHERE id = $1 AND version = $2
        RETURNING ${SUMMARY_COLUMNS}`,
      [
        request.params.id,
        body.data.version,
        body.data.name ?? null,
        'client' in (request.body as object),
        body.data.client,
        'subject' in (request.body as object),
        body.data.subject,
        JSON.stringify(document),
        PROJECT_SCHEMA_VERSION,
        request.user!.id,
      ],
    );
    if (!rows[0]) {
      return reply.code(409).send({
        error: 'version_conflict',
        message: 'Este projeto foi alterado por outra pessoa. Recarregue antes de salvar.',
      });
    }
    return { project: summary(rows[0]), issues };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', { preHandler: requirePermission('projects:delete') }, async (request, reply) => {
    if (!validId(request.params.id)) return reply.code(404).send(notFound);
    const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1', [request.params.id]);
    if (!rowCount) return reply.code(404).send(notFound);
    await fs.rm(assetsDir(config, request.params.id), { recursive: true, force: true });
    await audit(pool, request.user!.id, 'project_deleted', 'project', request.params.id);
    return reply.code(204).send();
  });
}
