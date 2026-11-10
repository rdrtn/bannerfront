import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { audit, requirePermission } from '../auth.js';
import type { AppContext } from '../app.js';

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await fs.stat(full)).size;
  }
  return total;
}

export function registerSystemRoutes(app: FastifyInstance, { pool, config }: AppContext): void {
  // Público: usado pelo healthcheck do Docker.
  app.get('/api/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'db_unavailable' });
    }
  });

  app.get('/api/system/info', { preHandler: requirePermission('system:manage') }, async () => {
    const counts = await pool.query<{ users: string; projects: string; fonts: string; sessions: string }>(
      `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM projects) AS projects,
              (SELECT count(*) FROM fonts) AS fonts, (SELECT count(*) FROM sessions WHERE expires_at > now()) AS sessions`,
    );
    const c = counts.rows[0]!;
    return {
      counts: { users: Number(c.users), projects: Number(c.projects), fonts: Number(c.fonts), activeSessions: Number(c.sessions) },
      disk: {
        fontsBytes: await dirSize(path.join(config.dataDir, 'fonts')),
        tempBytes: await dirSize(path.join(config.dataDir, 'tmp')),
      },
    };
  });

  // Limpa temporários e sessões vencidas. Não mexe em projetos nem em fontes.
  app.post('/api/system/clear-temp', { preHandler: requirePermission('system:manage') }, async (request) => {
    const tmp = path.join(config.dataDir, 'tmp');
    const freedBytes = await dirSize(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });
    const expired = await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
    await audit(pool, request.user!.id, 'temp_cleared', 'system', undefined, { freedBytes });
    return { freedBytes, expiredSessionsRemoved: expired.rowCount ?? 0 };
  });

  app.get('/api/audit', { preHandler: requirePermission('system:manage') }, async () => {
    const { rows } = await pool.query<{
      id: string;
      action: string;
      entity: string | null;
      entity_id: string | null;
      meta: unknown;
      created_at: Date;
      user_name: string | null;
    }>(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.meta, a.created_at, u.name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC LIMIT 200`,
    );
    return {
      entries: rows.map((r) => ({
        id: Number(r.id),
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        meta: r.meta,
        userName: r.user_name,
        createdAt: r.created_at.toISOString(),
      })),
    };
  });
}
