import fs from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from './app.js';
import { bootstrapAdmin } from './auth.js';
import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';

async function main(): Promise<void> {
  const config = loadConfig();
  await fs.mkdir(path.join(config.dataDir, 'fonts'), { recursive: true });
  await fs.mkdir(path.join(config.dataDir, 'tmp'), { recursive: true });

  const pool = createPool(config.databaseUrl);
  const applied = await migrate(pool);
  if (applied.length) console.log(`Migrações aplicadas: ${applied.join(', ')}`);

  if (await bootstrapAdmin(pool, config)) {
    console.log(`Administrador inicial criado: ${config.bootstrapAdmin!.email}`);
  } else if (!config.bootstrapAdmin) {
    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM users');
    if (Number(rows[0]?.count) === 0) {
      console.warn('Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o administrador inicial.');
    }
  }

  const app = await buildApp({ pool, config }, { logger: true });
  const close = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
