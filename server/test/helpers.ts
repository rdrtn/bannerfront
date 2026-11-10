import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import * as opentype from 'opentype.js';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, migrate, type Pool } from '../src/db.js';
import { hashPassword } from '../src/password.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export interface TestEnv {
  app: FastifyInstance;
  pool: Pool;
  config: Config;
  dataDir: string;
  close(): Promise<void>;
}

export async function setupEnv(overrides: NodeJS.ProcessEnv = {}): Promise<TestEnv> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bannerfront-test-'));
  const config = loadConfig({ DATABASE_URL: TEST_DATABASE_URL, DATA_DIR: dataDir, LOGIN_RATE_LIMIT: '1000', ...overrides });
  const pool = createPool(config.databaseUrl);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const app = await buildApp({ pool, config });
  return {
    app,
    pool,
    config,
    dataDir,
    async close() {
      await app.close();
      await pool.end();
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}

export async function createUser(
  pool: Pool,
  data: { email: string; role: string; name?: string; password?: string; active?: boolean },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (email, name, role, password_hash, active) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [data.email, data.name ?? data.email, data.role, await hashPassword(data.password ?? 'senha-super-segura'), data.active ?? true],
  );
  return rows[0]!.id;
}

export async function login(app: FastifyInstance, email: string, password = 'senha-super-segura'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'bf_session');
  if (!cookie) throw new Error('sem cookie de sessão');
  return `bf_session=${cookie.value}`;
}

/** Cria um usuário e já devolve o cookie dele. */
export async function userSession(env: TestEnv, role: string, email = `${role}@teste.com`): Promise<string> {
  await createUser(env.pool, { email, role });
  return login(env.app, email);
}

interface FontCtor {
  Font: new (opts: Record<string, unknown>) => { toArrayBuffer(): ArrayBuffer };
  Glyph: new (opts: Record<string, unknown>) => unknown;
  Path: new () => unknown;
}

/** Gera uma fonte TTF/OTF mínima e válida, só para os testes. */
export function makeTestFont(family: string, style = 'Regular', extra: Record<string, unknown> = {}): Buffer {
  const ot = opentype as unknown as FontCtor;
  const glyphs = [
    new ot.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 650, path: new ot.Path() }),
    new ot.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path: new ot.Path() }),
  ];
  const font = new ot.Font({
    familyName: family,
    styleName: style,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
    ...extra,
  });
  return Buffer.from(font.toArrayBuffer());
}

export function multipart(
  fields: Record<string, string>,
  file?: { name: string; data: Buffer; field?: string },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----bftest' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
