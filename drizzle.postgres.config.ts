import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/postgres-schema.ts',
  out: './.tools/postgres-migrations',
  dialect: 'postgresql',
});
