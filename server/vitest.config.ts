import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Os testes de integração compartilham um banco: rodam em série.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
