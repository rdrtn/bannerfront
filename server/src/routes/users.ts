import { ROLES } from '@bannerfront/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, deleteUserSessions, requirePermission } from '../auth.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../password.js';
import type { AppContext } from '../app.js';

const password = z.string().min(MIN_PASSWORD_LENGTH, `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(500);

const createBody = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('E-mail inválido.')),
  role: z.enum(ROLES),
  password,
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(ROLES),
    active: z.boolean(),
    password,
  })
  .partial();

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: Date;
}

const toApi = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  active: u.active,
  createdAt: u.created_at.toISOString(),
});

export function registerUserRoutes(app: FastifyInstance, { pool }: AppContext): void {
  const guard = { preHandler: requirePermission('users:manage') };

  app.get('/api/users', guard, async () => {
    const { rows } = await pool.query<UserRow>('SELECT id, email, name, role, active, created_at FROM users ORDER BY lower(name)');
    return { users: rows.map(toApi) };
  });

  app.post('/api/users', guard, async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Dados inválidos.' });
    }
    const { name, email, role } = body.data;
    try {
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role, active, created_at`,
        [email, name, role, await hashPassword(body.data.password)],
      );
      await audit(pool, request.user!.id, 'user_created', 'user', rows[0]!.id, { email, role });
      return reply.code(201).send({ user: toApi(rows[0]!) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'email_taken', message: 'Já existe um usuário com este e-mail.' });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', guard, async (request, reply) => {
    const body = updateBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Dados inválidos.' });
    }
    const { id } = request.params;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'Usuário não encontrado.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Bloqueia as linhas de administradores ativos para que dois pedidos simultâneos não removam o último.
      const { rows: admins } = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role = 'admin' AND active FOR UPDATE`,
      );
      const { rows: found } = await client.query<UserRow>(
        'SELECT id, email, name, role, active, created_at FROM users WHERE id = $1',
        [id],
      );
      const current = found[0];
      if (!current) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'not_found', message: 'Usuário não encontrado.' });
      }

      const next = {
        name: body.data.name ?? current.name,
        role: body.data.role ?? current.role,
        active: body.data.active ?? current.active,
      };
      const wasActiveAdmin = current.role === 'admin' && current.active;
      const staysActiveAdmin = next.role === 'admin' && next.active;
      if (wasActiveAdmin && !staysActiveAdmin && admins.length <= 1) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'last_admin',
          message: 'Este é o último administrador ativo. Crie outro antes de alterar o perfil ou desativar.',
        });
      }

      const sets = ['name = $2', 'role = $3', 'active = $4', 'updated_at = now()'];
      const params: unknown[] = [id, next.name, next.role, next.active];
      if (body.data.password) {
        params.push(await hashPassword(body.data.password));
        sets.push(`password_hash = $${params.length}`);
      }
      const { rows } = await client.query<UserRow>(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING id, email, name, role, active, created_at`,
        params,
      );
      await client.query('COMMIT');

      // Desativar, mudar o perfil ou redefinir a senha derruba as sessões abertas do usuário.
      if (!next.active || next.role !== current.role || body.data.password) {
        await deleteUserSessions(pool, id);
      }
      await audit(pool, request.user!.id, 'user_updated', 'user', id, {
        fields: Object.keys(body.data).map((k) => (k === 'password' ? 'password' : k)),
      });
      return { user: toApi(rows[0]!) };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
