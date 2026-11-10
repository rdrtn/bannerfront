import { createHash, randomBytes } from 'node:crypto';
import { can, isRole, type Permission, type Role } from '@bannerfront/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { hashPassword } from './password.js';

export const SESSION_COOKIE = 'bf_session';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | null;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(pool: Pool, userId: string, ttlHours: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/** Encerra as sessões do usuário, exceto (opcionalmente) a atual. */
export async function deleteUserSessions(pool: Pool, userId: string, exceptToken?: string | null): Promise<void> {
  if (exceptToken) {
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, hashToken(exceptToken)]);
  } else {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

/**
 * Resolve o usuário de uma sessão. Renova a validade quando passou da metade do prazo
 * (sessão "deslizante") e ignora usuários desativados.
 */
export async function resolveSession(pool: Pool, token: string, ttlHours: number): Promise<SessionUser | null> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    name: string;
    role: string;
    expires_at: Date;
  }>(
    `SELECT u.id, u.email, u.name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row || !isRole(row.role)) return null;

  const remaining = row.expires_at.getTime() - Date.now();
  if (remaining < (ttlHours * 3_600_000) / 2) {
    await pool.query('UPDATE sessions SET expires_at = $2 WHERE token_hash = $1', [
      hashToken(token),
      new Date(Date.now() + ttlHours * 3_600_000),
    ]);
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
}

/** Cria o administrador inicial (ADMIN_EMAIL/ADMIN_PASSWORD) quando ainda não há nenhum usuário. */
export async function bootstrapAdmin(pool: Pool, config: Config): Promise<boolean> {
  if (!config.bootstrapAdmin) return false;
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM users');
  if (Number(rows[0]?.count) > 0) return false;
  const { email, password, name } = config.bootstrapAdmin;
  await pool.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, 'admin', $3)`, [
    email,
    name,
    await hashPassword(password),
  ]);
  return true;
}

// --- guardas de rota -------------------------------------------------------

export async function requireLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthenticated', message: 'Faça login para continuar.' });
  }
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      await reply.code(401).send({ error: 'unauthenticated', message: 'Faça login para continuar.' });
      return;
    }
    if (!can(request.user.role, permission)) {
      await reply.code(403).send({ error: 'forbidden', message: 'Seu perfil não tem permissão para isso.' });
    }
  };
}

export async function audit(
  pool: Pool,
  userId: string | null,
  action: string,
  entity?: string,
  entityId?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await pool.query('INSERT INTO audit_log (user_id, action, entity, entity_id, meta) VALUES ($1, $2, $3, $4, $5)', [
    userId,
    action,
    entity ?? null,
    entityId ?? null,
    meta ? JSON.stringify(meta) : null,
  ]);
}
