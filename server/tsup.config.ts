import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // O pacote compartilhado é TypeScript puro: entra no bundle em vez de ser resolvido em runtime.
  noExternal: ['@bannerfront/shared'],
});
