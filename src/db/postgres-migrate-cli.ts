import { migratePostgres } from './postgres-migrate.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
await migratePostgres(url);
console.log('PostgreSQL migrations applied');
