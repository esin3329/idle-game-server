import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './postgres-schema.js';

export type PostgresDb = Pick<NodePgDatabase<typeof schema>, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'>;
const context = new AsyncLocalStorage<PostgresDb>();
const connectionStringContext = new AsyncLocalStorage<string>();
let pool: Pool | undefined;
let independentPool: Pool | undefined;

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
    return await connectionStringContext.run(connectionString, () => context.run(drizzle(client, { schema }), callback));
  } finally {
    await client.end();
  }
}

/**
 * Runs `callback` on a connection that is NOT part of the surrounding request transaction (autocommit),
 * so its writes survive a rollback of that transaction (e.g. rate-limit counters on 4xx responses).
 * - Inside withPostgresConnection (Workers): a fresh short-lived client.
 * - Otherwise (Node): a dedicated pool, separate from the request pool so concurrent in-flight
 *   transactions cannot exhaust it and deadlock waiting for their own independent query.
 */
export async function withIndependentPostgresConnection<T>(callback: (db: PostgresDb) => Promise<T>): Promise<T> {
  const activeConnectionString = connectionStringContext.getStore();
  if (activeConnectionString) {
    const client = new Client({ connectionString: activeConnectionString, connectionTimeoutMillis: 10000 });
    try {
      await client.connect();
      return await callback(drizzle(client, { schema }));
    } finally {
      await client.end();
    }
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL');
  independentPool ??= new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000 });
  return callback(drizzle(independentPool, { schema }));
}

export function withPostgresTransaction<T>(callback: () => Promise<T>): Promise<T> {
  return getDb().transaction((tx) => context.run(tx, callback));
}

export async function closePostgresPool(): Promise<void> {
  const pools = [pool, independentPool];
  pool = undefined;
  independentPool = undefined;
  await Promise.all(pools.map((p) => p?.end()));
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code === '23505') return true;
  return isPostgresUniqueViolation(error.cause);
}
