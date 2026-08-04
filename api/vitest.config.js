import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.js'],
    fileParallelism: false, // tests share one Postgres database
    hookTimeout: 30000,
    pool: 'forks',
    isolate: true, // per-file processes: test files each close the shared pg pool in afterAll
  },
});
