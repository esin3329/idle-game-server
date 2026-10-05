import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './postgres-schema.js';

export type PostgresDb = Pick<NodePgDatabase<typeof schema>, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'>;
const context = new AsyncLocalStorage<PostgresDb>();
let pool: Pool | undefined;

export function getDb(): PostgresDb {
  const current = context.getStore();
  if (current) return current;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL');
  pool ??= new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000 });
  return drizzle(pool, { schema });
}

export async function withPostgresConnection<T>(connectionString: string, callback: () => Promise<T>): Promise<T> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    return await context.run(drizzle(client, { schema }), callback);
  } finally {
    await client.end();
  }
}

export function withPostgresTransaction<T>(callback: () => Promise<T>): Promise<T> {
  return getDb().transaction((tx) => context.run(tx, callback));
}

export async function closePostgresPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code === '23505') return true;
  return isPostgresUniqueViolation(error.cause);
}
