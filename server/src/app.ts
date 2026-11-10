import fs from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { resolveSession, SESSION_COOKIE } from './auth.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerFontRoutes } from './routes/fonts.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerUserRoutes } from './routes/users.js';

export interface AppContext {
  pool: Pool;
  config: Config;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(ctx: AppContext, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const { pool, config } = ctx;
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyMultipart, { limits: { fileSize: config.maxFontBytes, files: 1, fields: 10 } });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  // Proteção contra CSRF: além do cookie SameSite=Lax, recusa requisições que alteram dados
  // vindas de outra origem (o navegador sempre envia Origin nesses casos).
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || !UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return reply.code(403).send({ error: 'bad_origin', message: 'Origem inválida.' });
    }
    if (originHost === request.headers.host || config.allowedOrigins.includes(origin)) return;
    return reply.code(403).send({ error: 'bad_origin', message: 'Origem não permitida.' });
  });

  // Identifica o usuário pela sessão em toda requisição da API.
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    request.sessionToken = token;
    request.user = await resolveSession(pool, token, config.sessionTtlHours);
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('referrer-policy', 'same-origin');
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'file_too_large', message: 'O arquivo é maior que o limite permitido.' });
    }
    if (error.statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.code ?? 'bad_request', message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal', message: 'Erro interno. Tente novamente.' });
  });

  registerAuthRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerFontRoutes(app, ctx);
  registerSystemRoutes(app, ctx);

  // Front-end compilado (produção / Docker), com fallback para o roteador do React.
  if (config.webDir && fs.existsSync(path.join(config.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET') {
        return reply.code(404).send({ error: 'not_found', message: 'Não encontrado.' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
