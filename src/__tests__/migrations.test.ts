import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXPECTED_MIGRATIONS = [
  '20261005083456_game_postgres.sql',
  '20261005083457_crafting_idempotency.sql',
  '20261005083458_battle_upgrade_option_constraints.sql',
  '20261127000001_normalize_stage_ids.sql',
];

describe('PostgreSQL (Supabase) migrations', () => {
  it('lists every committed SQL migration in supabase/migrations', async () => {
    const files = (await readdir(resolve('supabase/migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toEqual(EXPECTED_MIGRATIONS);
  });

  it('defines the isolated game schema with RLS enabled', async () => {
    for (const file of EXPECTED_MIGRATIONS) {
      const migration = await readFile(resolve('supabase/migrations', file), 'utf8');
      expect(migration.trim().length).toBeGreaterThan(0);
    }
    const baseMigration = await readFile(resolve('supabase/migrations', EXPECTED_MIGRATIONS[0]), 'utf8');
    expect(baseMigration).toContain('CREATE SCHEMA IF NOT EXISTS "game"');
    expect(baseMigration).toContain('ENABLE ROW LEVEL SECURITY');
  });
});
