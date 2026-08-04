import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.js'],
    fileParallelism: false, // tests share one Postgres database
    hookTimeout: 30000,
  },
});
