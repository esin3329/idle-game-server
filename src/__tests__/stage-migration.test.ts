import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratePostgres } from '../db/postgres-migrate.js';

// Dedicated port: `npm run test:postgres` uses 55437.
const PORT = 55439;
const MIGRATION = '20261127000001_normalize_stage_ids.sql';
const LAST_PRE_NORMALIZATION = '20261005083458_battle_upgrade_option_constraints.sql';
const LEGACY_IDS = ['stage_02_canyon', 'stage_03_furnace', 'stage_04_fortress'];

const password = randomUUID();
let dir = '';
let postgres: EmbeddedPostgres;
const url = (database: string) =>
  'postgresql://postgres:' + encodeURIComponent(password) + '@127.0.0.1:' + PORT + '/' + database;

async function withClient<T>(database: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url(database) });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const at = (day: string) => new Date(`2026-${day}T00:00:00.000Z`);

beforeAll(async () => {
  await mkdir('.tools', { recursive: true });
  dir = await mkdtemp(resolve('.tools/stage-migration-'));
  postgres = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password, port: PORT,
    persistent: true, createPostgresUser: false,
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
    onLog: () => {}, onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  await withClient('postgres', async (client) => {
    await client.query('CREATE DATABASE stage_full');
    await client.query('CREATE DATABASE stage_legacy');
  });
}, 120_000);

afterAll(async () => {
  try { await postgres?.stop(); } finally {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}, 60_000);

describe('migratePostgres with the stage normalization migration', () => {
  it('applies every migration and is idempotent on the second run', async () => {
    await migratePostgres(url('stage_full'));
    await migratePostgres(url('stage_full'));
    await withClient('stage_full', async (client) => {
      const files = (await readdir('supabase/migrations')).filter((n) => n.endsWith('.sql')).sort();
      expect(files).toContain(MIGRATION);
      const applied = await client.query<{ name: string }>('SELECT name FROM game.schema_migrations ORDER BY name');
      expect(applied.rows.map((r) => r.name)).toEqual(files);
    });
  }, 60_000);
});

interface Snapshot { [table: string]: unknown[] }

async function snapshot(client: Client): Promise<Snapshot> {
  const q = async (sql: string) => (await client.query(sql)).rows;
  return {
    stages: await q('SELECT id, entry_requirement FROM game.stages ORDER BY id'),
    bosses: await q('SELECT stage_id, boss_code, sequence FROM game.stage_bosses ORDER BY stage_id, sequence'),
    rewards: await q('SELECT stage_id, clear_type, scrap_min FROM game.stage_rewards ORDER BY stage_id, clear_type'),
    sessions: await q('SELECT id, stage_id FROM game.battle_sessions ORDER BY id'),
    progress: await q('SELECT * FROM game.player_stage_progress ORDER BY player_id, stage_id'),
    records: await q('SELECT * FROM game.player_records ORDER BY player_id, stage_id'),
  };
}

describe('stage ID normalization on a pre-normalization database', () => {
  let before: Snapshot;
  let afterFirst: Snapshot;
  let afterSecond: Snapshot;

  beforeAll(async () => {
    await withClient('stage_legacy', async (client) => {
      // Build the exact pre-normalization state: record all migrations except the new one as applied.
      await client.query('CREATE SCHEMA IF NOT EXISTS game');
      await client.query('CREATE TABLE game.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      const files = (await readdir('supabase/migrations')).filter((n) => n.endsWith('.sql')).sort()
        .filter((n) => n <= LAST_PRE_NORMALIZATION);
      expect(files).not.toContain(MIGRATION);
      for (const name of files) {
        const sql = await readFile('supabase/migrations/' + name, 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO game.schema_migrations(name, checksum) VALUES($1, $2)', [name, createHash('sha256').update(sql).digest('hex')]);
      }

      const created = at('01-01');
      const stage = (id: string, seq: number, entry: string) => client.query(
        `INSERT INTO game.stages (id, name, sequence, entry_requirement, duration_seconds, created_at) VALUES ($1,$2,$3,$4,180,$5)`,
        [id, id, seq, entry, created]);
      await stage('stage_01_ruins', 1, 'none');
      await stage('stage_02_canyon', 2, 'stage_01_ruins');
      await stage('stage_03_furnace', 3, 'clear_stage_02_canyon');
      await stage('stage_03_lab', 3, 'stage_02_canyon'); // canonical already exists beside legacy
      await stage('stage_04_fortress', 4, 'stage_03_furnace');

      const boss = (stage_id: string, code: string, seq: number) => client.query(
        `INSERT INTO game.stage_bosses (id, stage_id, boss_code, sequence, checkpoint_seconds, created_at) VALUES ($1,$2,$3,$4,60,$5)`,
        [randomUUID(), stage_id, code, seq, created]);
      await boss('stage_02_canyon', 'boss_factory_foreman', 1);
      await boss('stage_02_canyon', 'boss_factory_assembly', 2);
      await boss('stage_03_furnace', 'boss_factory_assembly', 1); // same sequence as canonical lab boss
      await boss('stage_03_furnace', 'boss_lab_mutant', 2); // same boss_code as canonical lab boss
      await boss('stage_03_lab', 'boss_lab_mutant', 1);
      await boss('stage_04_fortress', 'boss_core_sentinel', 1);
      await boss('stage_04_core', 'boss_core_overlord', 2);

      const reward = (stage_id: string, type: string, scrap: number) => client.query(
        `INSERT INTO game.stage_rewards (id, stage_id, clear_type, scrap_min, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), stage_id, type, scrap, created]);
      await reward('stage_02_canyon', 'partial', 11);
      await reward('stage_02_canyon', 'normal', 12); // duplicate of canonical below
      await reward('stage_02_factory', 'normal', 22);
      await reward('stage_03_furnace', 'first', 33);

      const session = (id: string, stage_id: string) => client.query(
        `INSERT INTO game.battle_sessions (id, player_id, stage_id, start_time, started_at, created_at, updated_at) VALUES ($1,'p1',$2,$3,$3,$3,$3)`,
        [id, stage_id, created]);
      await session('s-canyon', 'stage_02_canyon');
      await session('s-fortress', 'stage_04_fortress');
      await session('s-canonical', 'stage_02_factory');

      const progress = (id: string, player: string, stage_id: string, unlocked: Date | null, first: Date | null,
        bestMs: number | null, boss: number, clears: number, updated: Date) => client.query(
        `INSERT INTO game.player_stage_progress (id, player_id, user_id, stage_id, unlocked_at, first_cleared_at, best_clear_time_ms, highest_boss_sequence, clear_count, created_at, updated_at)
         VALUES ($1,$2,'u',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, player, stage_id, unlocked, first, bestMs, boss, clears, created, updated]);
      // p1: conflict; legacy has the better time / boss, older unlock, newer update; canonical has no first clear.
      await progress('psp-1l', 'p1', 'stage_02_canyon', at('01-01'), at('01-10'), 90000, 2, 3, at('02-01'));
      await progress('psp-1c', 'p1', 'stage_02_factory', at('01-03'), null, 120000, 1, 2, at('01-20'));
      // p2: legacy only.
      await progress('psp-2l', 'p2', 'stage_03_furnace', at('01-05'), at('01-06'), 70000, 1, 4, at('01-07'));
      // p3: canonical only.
      await progress('psp-3c', 'p3', 'stage_04_core', at('01-05'), null, null, 0, 0, at('01-08'));
      // p4: conflict; legacy has no best time, canonical does and has an older first clear / newer unlock.
      await progress('psp-4l', 'p4', 'stage_04_fortress', null, at('03-01'), null, 3, 1, at('03-02'));
      await progress('psp-4c', 'p4', 'stage_04_core', at('01-09'), at('02-01'), 100000, 2, 5, at('02-02'));

      const record = (id: string, player: string, stage_id: string, bestSec: number | null, kills: number,
        total: number, first: Date | null, last: Date | null, updated: Date) => client.query(
        `INSERT INTO game.player_records (id, player_id, stage_id, best_clear_time_sec, best_kill_count, total_clears, first_cleared_at, last_cleared_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, player, stage_id, bestSec, kills, total, first, last, created, updated]);
      await record('pr-1l', 'p1', 'stage_02_canyon', 80, 250, 3, at('01-10'), at('02-01'), at('02-01'));
      await record('pr-1c', 'p1', 'stage_02_factory', 95, 300, 2, at('01-04'), at('01-20'), at('01-20'));
      await record('pr-2l', 'p2', 'stage_03_furnace', 60, 120, 4, at('01-06'), at('01-07'), at('01-07'));
      await record('pr-3c', 'p3', 'stage_04_core', null, 0, 0, null, null, at('01-08'));
      await record('pr-4l', 'p4', 'stage_04_fortress', null, 50, 1, null, null, at('03-02'));
      await record('pr-4c', 'p4', 'stage_04_core', 110, 40, 2, at('02-01'), at('02-02'), at('02-02'));

      before = await snapshot(client);
    });

    // First application goes through the real migration runner.
    await migratePostgres(url('stage_legacy'));
    await withClient('stage_legacy', async (client) => { afterFirst = await snapshot(client); });

    // Re-run the SQL directly (the runner would skip it by checksum) to prove statement-level idempotency.
    const sql = await readFile('supabase/migrations/' + MIGRATION, 'utf8');
    await withClient('stage_legacy', async (client) => {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      afterSecond = await snapshot(client);
    });
    await migratePostgres(url('stage_legacy'));
  }, 120_000);

  it('starts with legacy IDs in every referencing table', () => {
    for (const table of ['bosses', 'rewards', 'sessions', 'progress', 'records'] as const) {
      const stageIds = (before[table] as { stage_id: string }[]).map((r) => r.stage_id);
      expect(stageIds.some((id) => LEGACY_IDS.includes(id)), table).toBe(true);
    }
  });

  it('leaves no legacy stage ID anywhere', async () => {
    await withClient('stage_legacy', async (client) => {
      for (const table of ['stages', 'stage_bosses', 'stage_rewards', 'battle_sessions', 'player_stage_progress', 'player_records']) {
        const column = table === 'stages' ? 'id' : 'stage_id';
        const r = await client.query(`SELECT count(*)::int AS n FROM game.${table} WHERE ${column} = ANY($1)`, [LEGACY_IDS]);
        expect(r.rows[0].n, table).toBe(0);
      }
      const entry = await client.query(
        `SELECT count(*)::int AS n FROM game.stages WHERE ${LEGACY_IDS.map((_, i) => `entry_requirement LIKE $${i + 1}`).join(' OR ')}`,
        LEGACY_IDS.map((id) => `%${id}%`));
      expect(entry.rows[0].n).toBe(0);
    });
  });

  it('renames stages, drops legacy duplicates and rewrites entry_requirement', () => {
    expect(afterFirst.stages).toEqual([
      { id: 'stage_01_ruins', entry_requirement: 'none' },
      { id: 'stage_02_factory', entry_requirement: 'stage_01_ruins' },
      { id: 'stage_03_lab', entry_requirement: 'stage_02_factory' },
      { id: 'stage_04_core', entry_requirement: 'stage_03_lab' },
    ]);
  });

  it('moves stage_bosses and drops colliding legacy rows', () => {
    expect(afterFirst.bosses).toEqual([
      { stage_id: 'stage_02_factory', boss_code: 'boss_factory_foreman', sequence: 1 },
      { stage_id: 'stage_02_factory', boss_code: 'boss_factory_assembly', sequence: 2 },
      { stage_id: 'stage_03_lab', boss_code: 'boss_lab_mutant', sequence: 1 },
      { stage_id: 'stage_04_core', boss_code: 'boss_core_sentinel', sequence: 1 },
      { stage_id: 'stage_04_core', boss_code: 'boss_core_overlord', sequence: 2 },
    ]);
  });

  it('keeps canonical stage_rewards on conflict and moves the rest', () => {
    expect(afterFirst.rewards).toEqual([
      { stage_id: 'stage_02_factory', clear_type: 'normal', scrap_min: 22 },
      { stage_id: 'stage_02_factory', clear_type: 'partial', scrap_min: 11 },
      { stage_id: 'stage_03_lab', clear_type: 'first', scrap_min: 33 },
    ]);
  });

  it('retargets battle_sessions', () => {
    expect(afterFirst.sessions).toEqual([
      { id: 's-canonical', stage_id: 'stage_02_factory' },
      { id: 's-canyon', stage_id: 'stage_02_factory' },
      { id: 's-fortress', stage_id: 'stage_04_core' },
    ]);
  });

  it('merges conflicting player_stage_progress rows and moves legacy-only rows', () => {
    const rows = afterFirst.progress as Record<string, any>[];
    expect(rows.map((r) => [r.player_id, r.stage_id])).toEqual([
      ['p1', 'stage_02_factory'], ['p2', 'stage_03_lab'], ['p3', 'stage_04_core'], ['p4', 'stage_04_core'],
    ]);
    const [p1, p2, p3, p4] = rows;
    expect(p1).toMatchObject({ id: 'psp-1c', clear_count: 5, highest_boss_sequence: 2, best_clear_time_ms: 90000 });
    expect([iso(p1.unlocked_at), iso(p1.first_cleared_at), iso(p1.updated_at)])
      .toEqual([at('01-01').toISOString(), at('01-10').toISOString(), at('02-01').toISOString()]);
    expect(p2).toMatchObject({ id: 'psp-2l', clear_count: 4, highest_boss_sequence: 1, best_clear_time_ms: 70000 });
    expect(p3).toMatchObject({ id: 'psp-3c', clear_count: 0, best_clear_time_ms: null });
    expect(p4).toMatchObject({ id: 'psp-4c', clear_count: 6, highest_boss_sequence: 3, best_clear_time_ms: 100000 });
    expect([iso(p4.unlocked_at), iso(p4.first_cleared_at), iso(p4.updated_at)])
      .toEqual([at('01-09').toISOString(), at('02-01').toISOString(), at('03-02').toISOString()]);
  });

  it('merges conflicting player_records rows and moves legacy-only rows', () => {
    const rows = afterFirst.records as Record<string, any>[];
    expect(rows.map((r) => [r.player_id, r.stage_id])).toEqual([
      ['p1', 'stage_02_factory'], ['p2', 'stage_03_lab'], ['p3', 'stage_04_core'], ['p4', 'stage_04_core'],
    ]);
    const [p1, p2, p3, p4] = rows;
    expect(p1).toMatchObject({ id: 'pr-1c', total_clears: 5, best_kill_count: 300, best_clear_time_sec: 80 });
    expect([iso(p1.first_cleared_at), iso(p1.last_cleared_at), iso(p1.updated_at)])
      .toEqual([at('01-04').toISOString(), at('02-01').toISOString(), at('02-01').toISOString()]);
    expect(p2).toMatchObject({ id: 'pr-2l', total_clears: 4, best_kill_count: 120, best_clear_time_sec: 60 });
    expect(p3).toMatchObject({ id: 'pr-3c', total_clears: 0, best_clear_time_sec: null });
    expect(p4).toMatchObject({ id: 'pr-4c', total_clears: 3, best_kill_count: 50, best_clear_time_sec: 110 });
    expect([iso(p4.first_cleared_at), iso(p4.last_cleared_at), iso(p4.updated_at)])
      .toEqual([at('02-01').toISOString(), at('02-02').toISOString(), at('03-02').toISOString()]);
  });

  it('is idempotent: re-running the SQL changes nothing', () => {
    expect(afterSecond).toEqual(afterFirst);
  });
});
