import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'admin/**', 'node_modules/**'],
    fileParallelism: false,
    env: {
      DB_DRIVER: 'json',
      JWT_ACCESS_SECRET: 'dev-secret-change-in-production',
      JWT_REFRESH_SECRET: 'dev-secret-change-in-production',
    },
  },
});
