import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  audit,
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteUserSessions,
  requireLogin,
  SESSION_COOKIE,
  setSessionCookie,
} from '../auth.js';
import { getDummyHash, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../password.js';
import type { AppContext } from '../app.js';

const loginBody = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(500) });

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(500),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(500),
});

export function registerAuthRoutes(app: FastifyInstance, { pool, config }: AppContext): void {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: config.loginRateLimit, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = loginBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: 'Informe e-mail e senha.' });

      const { rows } = await pool.query<{
        id: string;
        email: string;
        name: string;
        role: string;
        password_hash: string;
        active: boolean;
      }>('SELECT id, email, name, role, password_hash, active FROM users WHERE lower(email) = lower($1)', [body.data.email]);
      const user = rows[0];

      // Sempre calcula o hash, exista o usuário ou não, para não revelar e-mails cadastrados pelo tempo de resposta.
      const ok = await verifyPassword(body.data.password, user?.password_hash ?? (await getDummyHash()));
      if (!user || !ok || !user.active) {
        await audit(pool, user?.id ?? null, 'login_failed', 'user', user?.id, { email: body.data.email, ip: request.ip });
        return reply.code(401).send({ error: 'invalid_credentials', message: 'E-mail ou senha incorretos.' });
      }

      const session = await createSession(pool, user.id, config.sessionTtlHours);
      setSessionCookie(reply, config, session.token, session.expiresAt);
      await audit(pool, user.id, 'login', 'user', user.id, { ip: request.ip });
      return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(pool, token);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireLogin }, async (request) => ({ user: request.user }));

  app.post(
    '/api/auth/change-password',
    { preHandler: requireLogin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = changePasswordBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Dados inválidos.' });
      }
      const user = request.user!;
      const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      if (!rows[0] || !(await verifyPassword(body.data.currentPassword, rows[0].password_hash))) {
        return reply.code(400).send({ error: 'wrong_password', message: 'A senha atual está incorreta.' });
      }
      await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        user.id,
        await hashPassword(body.data.newPassword),
      ]);
      // Encerra as outras sessões; a atual continua.
      await deleteUserSessions(pool, user.id, request.sessionToken);
      await audit(pool, user.id, 'password_changed', 'user', user.id);
      return reply.code(204).send();
    },
  );
}
