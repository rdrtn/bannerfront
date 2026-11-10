import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Pool = pg.Pool;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Pasta das migrações: ao lado do código (dev) ou em ../migrations (build). */
export async function defaultMigrationsDir(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, '../migrations'), path.resolve(here, '../../migrations')]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // tenta o próximo
    }
  }
  throw new Error('Pasta de migrações não encontrada.');
}

const LOCK_KEY = 727_001; // advisory lock: impede duas instâncias migrando ao mesmo tempo

/** Aplica, em ordem, os arquivos .sql ainda não registrados em schema_migrations. */
export async function migrate(pool: Pool, dir?: string): Promise<string[]> {
  const migrationsDir = dir ?? (await defaultMigrationsDir());
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return applied;
}
