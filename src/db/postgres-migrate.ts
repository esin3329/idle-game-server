import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Client } from 'pg';

export async function migratePostgres(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('idle-game-schema', 0))");
    await client.query('CREATE SCHEMA IF NOT EXISTS game');
    await client.query('CREATE TABLE IF NOT EXISTS game.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const files = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
    for (const name of files) {
      const query = await readFile('supabase/migrations/' + name, 'utf8');
      if (!query.trim()) throw new Error('Empty migration: ' + name);
      const checksum = createHash('sha256').update(query).digest('hex');
      const existing = await client.query<{ checksum: string }>('SELECT checksum FROM game.schema_migrations WHERE name = $1', [name]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error('Applied migration changed: ' + name);
        continue;
      }
      await client.query(query);
      await client.query('INSERT INTO game.schema_migrations(name, checksum) VALUES($1, $2)', [name, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}
