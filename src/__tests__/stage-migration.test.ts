import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratePostgres } from '../db/postgres-migrate.js';
import { withPostgresConnection } from '../db/postgres-connection.js';
import { seed } from '../db/battle-seed.js';
import { STAGES, getStageBosses } from '../data/stages.js';

const MIGRATION = '20261127000001_normalize_stage_ids.sql';
const LAST_PRE_NORMALIZATION = '20261005083458_battle_upgrade_option_constraints.sql';
const LEGACY_IDS = ['stage_02_canyon', 'stage_03_furnace', 'stage_04_fortress'];

const password = randomUUID();
let dir = '';
let port = 0;
let pgStarted = false;
let postgres: EmbeddedPostgres;
const url = (database: string) =>
  'postgresql://postgres:' + encodeURIComponent(password) + '@127.0.0.1:' + port + '/' + database;

/** Ask the OS for a free ephemeral port (never collides with `npm run test:postgres`). */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not allocate a free port');
  return address.port;
}

async function withClient<T>(database: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url(database) });
  client.on('error', () => {});
  await client.connect();
  try { return await fn(client); } finally { await client.end().catch(() => {}); }
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const at = (day: string) => new Date(`2026-${day}T00:00:00.000Z`);

beforeAll(async () => {
  await mkdir('.tools', { recursive: true });
  dir = await mkdtemp(resolve('.tools/stage-migration-'));
  port = await freePort();
  postgres = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password, port,
    persistent: true, createPostgresUser: false,
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
    onLog: () => {}, onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  pgStarted = true;
  await withClient('postgres', async (client) => {
    await client.query('CREATE DATABASE stage_full');
    await client.query('CREATE DATABASE stage_legacy');
  });
}, 120_000);

afterAll(async () => {
  try {
    if (pgStarted) await postgres.stop();
  } finally {
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
      const stages = await client.query('SELECT count(*)::int AS n FROM game.stages');
      expect(stages.rows[0].n).toBe(0); // fresh DB: no stage content is invented
    });
  }, 60_000);
});

interface Snapshot { [table: string]: unknown[] }
type Row = Record<string, any>;

async function snapshot(client: Client): Promise<Snapshot> {
  const q = async (sql: string) => (await client.query(sql)).rows;
  return {
    stages: await q('SELECT * FROM game.stages ORDER BY id'),
    bosses: await q('SELECT id, stage_id, boss_code, sequence FROM game.stage_bosses ORDER BY stage_id, sequence, id'),
    rewards: await q('SELECT id, stage_id, clear_type, scrap_min FROM game.stage_rewards ORDER BY stage_id, clear_type, id'),
    sessions: await q('SELECT id, stage_id, status, result_code, end_time, completed_at FROM game.battle_sessions ORDER BY id'),
    progress: await q('SELECT * FROM game.player_stage_progress ORDER BY player_id, stage_id'),
    records: await q('SELECT * FROM game.player_records ORDER BY player_id, stage_id'),
  };
}

describe('stage ID normalization on a pre-normalization database', () => {
  let before: Snapshot;
  let afterFirst: Snapshot;
  let afterSecond: Snapshot;
  let metadataBeforeSeed: Row[];
  let migrationRanAt: Date;

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
      const stage = (id: string, seq: number, entry: string, bossTimings = '[180,360,540]') => client.query(
        `INSERT INTO game.stages (id, name, sequence, entry_requirement, duration_seconds, boss_timings, created_at) VALUES ($1,$2,$3,$4,540,$5,$6)`,
        [id, id, seq, entry, bossTimings, created]);
      await stage('stage_01_ruins', 1, 'none');
      await stage('stage_02_canyon', 2, 'stage_01_ruins');
      await stage('stage_03_furnace', 3, 'clear_stage_02_canyon');
      await stage('stage_03_lab', 3, 'stage_02_canyon', '[180,360]'); // canonical already exists beside legacy
      await stage('stage_04_fortress', 4, 'stage_03_furnace');

      const boss = (stage_id: string, code: string, seq: number, id = randomUUID(), createdAt = created) => client.query(
        `INSERT INTO game.stage_bosses (id, stage_id, boss_code, sequence, checkpoint_seconds, created_at) VALUES ($1,$2,$3,$4,60,$5)`,
        [id, stage_id, code, seq, createdAt]);
      await boss('stage_02_canyon', 'boss_factory_foreman', 1);
      await boss('stage_02_canyon', 'boss_factory_assembly', 2);
      await boss('stage_03_furnace', 'boss_factory_assembly', 1); // same sequence as canonical lab boss
      await boss('stage_03_furnace', 'boss_lab_mutant', 2); // same boss_code as canonical lab boss
      await boss('stage_03_lab', 'boss_lab_mutant', 1);
      await boss('stage_04_fortress', 'boss_core_sentinel', 1);
      await boss('stage_04_core', 'boss_core_overlord', 2);
      // Exact duplicates with identical created_at: smallest id must survive.
      await boss('stage_04_core', 'boss_final_overmind', 3, 'bb-2');
      await boss('stage_04_core', 'boss_final_overmind', 3, 'bb-1');

      const reward = (stage_id: string, type: string, scrap: number, id = randomUUID(), createdAt = created) => client.query(
        `INSERT INTO game.stage_rewards (id, stage_id, clear_type, scrap_min, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [id, stage_id, type, scrap, createdAt]);
      await reward('stage_02_canyon', 'partial', 11);
      await reward('stage_02_canyon', 'normal', 12); // duplicate of canonical below
      await reward('stage_02_factory', 'normal', 22);
      await reward('stage_03_furnace', 'first', 33);
      // Duplicates inside one canonical stage: earliest created_at wins, then smallest id.
      await reward('stage_04_core', 'partial', 41, 'rw-late', at('01-05'));
      await reward('stage_04_core', 'partial', 42, 'rw-early', at('01-02'));
      await reward('stage_04_core', 'normal', 43, 'rw-tie-b');
      await reward('stage_04_core', 'normal', 44, 'rw-tie-a');

      const session = (id: string, stage_id: string, status: string, resultCode: string | null = null, endTime: Date | null = null, player = 'p1') => client.query(
        `INSERT INTO game.battle_sessions (id, player_id, stage_id, status, result_code, end_time, completed_at, start_time, started_at, created_at, updated_at)
         VALUES ($1,$7,$2,$3,$4,$5,$5,$6,$6,$6,$6)`,
        [id, stage_id, status, resultCode, endTime, created, player]);
      await session('s-canyon', 'stage_02_canyon', 'active');
      await session('s-fortress', 'stage_04_fortress', 'completing');
      await session('s-furnace-active', 'stage_03_furnace', 'active');
      await session('s-furnace-done', 'stage_03_furnace', 'completed', 'victory', at('01-15'));
      await session('s-canonical', 'stage_02_factory', 'active');
      await session('s-lab-active', 'stage_03_lab', 'active');
      await session('s-ruins-active', 'stage_01_ruins', 'active');
      await session('s-userkey-active', 'stage_01_ruins', 'active', null, null, 'q-user');
      await session('s-userkey-completing', 'stage_03_lab', 'completing', null, null, 'q-user');
      await session('s-ruins-done', 'stage_01_ruins', 'completed', 'victory', at('01-16'));
      await session('s-ruins-abandoned', 'stage_01_ruins', 'abandoned', 'abandon', at('01-17'));

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
      // q: rows stored under users.id (q-user) must end up under profile.player_id (q-player).
      await progress('psp-qu-l', 'q-user', 'stage_02_canyon', at('01-02'), at('01-12'), 85000, 2, 2, at('02-10'));
      await progress('psp-qp-c', 'q-player', 'stage_02_factory', at('01-04'), null, 95000, 1, 1, at('02-05'));
      await progress('psp-qu-r', 'q-user', 'stage_01_ruins', at('01-01'), at('01-02'), 60000, 1, 7, at('02-06'));
      // Unknown owner without a profile is left alone.
      await progress('psp-orphan', 'no-profile', 'stage_04_fortress', null, null, null, 0, 1, at('02-06'));

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
      await record('pr-qu-l', 'q-user', 'stage_02_canyon', 70, 200, 2, at('01-11'), at('02-11'), at('02-11'));
      await record('pr-qp-c', 'q-player', 'stage_02_factory', 99, 260, 1, at('01-05'), at('01-06'), at('01-06'));

      await client.query(
        `INSERT INTO game.player_profiles (id, player_id, user_id, nickname, created_at, updated_at) VALUES ('pf-q','q-player','q-user','q',$1,$1)`,
        [created]);

      before = await snapshot(client);
    });

    // First application goes through the real migration runner.
    await migratePostgres(url('stage_legacy'));
    // No battle-seed has run: this is the state a Worker would see right after the migration.
    await withClient('stage_legacy', async (client) => {
      afterFirst = await snapshot(client);
      metadataBeforeSeed = (await client.query('SELECT * FROM game.stages ORDER BY id')).rows;
      migrationRanAt = (await client.query<{ applied_at: Date }>('SELECT applied_at FROM game.schema_migrations WHERE name = $1', [MIGRATION])).rows[0].applied_at;
    });

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
    const stages = afterFirst.stages as Row[];
    expect(stages.map((s) => [s.id, s.entry_requirement])).toEqual([
      ['stage_01_ruins', 'none'],
      ['stage_02_factory', 'stage_01_ruins'],
      ['stage_03_lab', 'stage_02_factory'],
      ['stage_04_core', 'stage_03_lab'],
    ]);
  });

  it('syncs canonical stage metadata with src/data/stages.ts before any battle-seed run', () => {
    for (const def of STAGES.filter((s) => s.sequence >= 2)) {
      const row = metadataBeforeSeed.find((r) => r.id === def.id);
      expect(row, def.id).toBeDefined();
      expect(row).toMatchObject({
        name: def.name,
        description: def.description,
        sequence: def.sequence,
        entry_requirement: def.entryRequirement,
        duration_seconds: def.durationSeconds,
        recommended_power: def.recommendedPower,
        enemy_set: JSON.stringify(def.enemySet),
        boss_timings: JSON.stringify(def.bossTimings),
        max_kills: def.maxKills,
        max_core_energy: def.maxCoreEnergy,
        core_per_level: def.corePerLevel,
        core_per_kill: def.corePerKill,
        scrap_per_kill: def.scrapPerKill,
        content_version: def.contentVersion,
      });
      expect(JSON.parse(row!.boss_timings).length, def.id).toBe(getStageBosses(def.id).length);
    }
    // stage_01 is not part of the rename and is left as-is.
    expect(metadataBeforeSeed.find((r) => r.id === 'stage_01_ruins')!.duration_seconds).toBe(540);
  });

  it('moves stage_bosses, drops colliding legacy rows and dedupes deterministically', () => {
    const bosses = (afterFirst.bosses as Row[]).map(({ id, ...rest }) => (id === 'bb-1' ? { id, ...rest } : rest));
    expect(bosses).toEqual([
      { stage_id: 'stage_02_factory', boss_code: 'boss_factory_foreman', sequence: 1 },
      { stage_id: 'stage_02_factory', boss_code: 'boss_factory_assembly', sequence: 2 },
      { stage_id: 'stage_03_lab', boss_code: 'boss_lab_mutant', sequence: 1 },
      { stage_id: 'stage_04_core', boss_code: 'boss_core_sentinel', sequence: 1 },
      { stage_id: 'stage_04_core', boss_code: 'boss_core_overlord', sequence: 2 },
      { id: 'bb-1', stage_id: 'stage_04_core', boss_code: 'boss_final_overmind', sequence: 3 },
    ]);
  });

  it('keeps canonical stage_rewards on conflict, moves the rest and dedupes deterministically', () => {
    const rewards = (afterFirst.rewards as Row[]).map(({ id, ...rest }) => (id.startsWith('rw-') ? { id, ...rest } : rest));
    expect(rewards).toEqual([
      { stage_id: 'stage_02_factory', clear_type: 'normal', scrap_min: 22 },
      { stage_id: 'stage_02_factory', clear_type: 'partial', scrap_min: 11 },
      { stage_id: 'stage_03_lab', clear_type: 'first', scrap_min: 33 },
      { id: 'rw-tie-a', stage_id: 'stage_04_core', clear_type: 'normal', scrap_min: 44 },
      { id: 'rw-early', stage_id: 'stage_04_core', clear_type: 'partial', scrap_min: 42 },
    ]);
  });

  it('creates unique indexes that reject new duplicates', async () => {
    await withClient('stage_legacy', async (client) => {
      const idx = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname='game' AND indexname IN ('uq_sr_stage_clear_type','uq_sb_stage_sequence_boss') ORDER BY indexname`);
      expect(idx.rows.map((r) => r.indexname)).toEqual(['uq_sb_stage_sequence_boss', 'uq_sr_stage_clear_type']);
      await expect(client.query(
        `INSERT INTO game.stage_rewards (id, stage_id, clear_type, created_at) VALUES ('dup','stage_03_lab','first',now())`,
      )).rejects.toThrow(/uq_sr_stage_clear_type/);
    });
  });

  it('abandons every in-flight session (any stage, any owner) and keeps finished ones intact', () => {
    const sessions = afterFirst.sessions as Row[];
    const byId = (id: string) => sessions.find((s) => s.id === id)!;
    const inFlight: Record<string, string> = {
      's-canyon': 'stage_02_factory', 's-fortress': 'stage_04_core', 's-furnace-active': 'stage_03_lab',
      's-canonical': 'stage_02_factory', 's-lab-active': 'stage_03_lab', 's-ruins-active': 'stage_01_ruins',
      's-userkey-active': 'stage_01_ruins', 's-userkey-completing': 'stage_03_lab',
    };
    for (const [id, stageId] of Object.entries(inFlight)) {
      const s = byId(id);
      expect(s.stage_id, id).toBe(stageId);
      expect(s.status, id).toBe('abandoned');
      expect(s.result_code, id).toBe('STAGE_MIGRATION_RESET');
      expect(s.end_time, id).toBeInstanceOf(Date);
      expect(s.completed_at, id).toBeInstanceOf(Date);
      expect(s.end_time.getTime(), id).toBeGreaterThan(at('02-01').getTime());
      // end_time is timestamp(3); applied_at keeps microseconds, so allow rounding.
      expect(Math.abs(s.end_time.getTime() - migrationRanAt.getTime()), id).toBeLessThan(5);
    }
    const done = byId('s-furnace-done');
    expect(done).toMatchObject({ stage_id: 'stage_03_lab', status: 'completed', result_code: 'victory' });
    expect(iso(done.end_time)).toBe(at('01-15').toISOString());
    expect(iso(done.completed_at)).toBe(at('01-15').toISOString());
    // Already-finished sessions on other stages are untouched.
    expect(byId('s-ruins-done')).toMatchObject({ stage_id: 'stage_01_ruins', status: 'completed', result_code: 'victory' });
    expect(iso(byId('s-ruins-done').end_time)).toBe(at('01-16').toISOString());
    expect(byId('s-ruins-abandoned')).toMatchObject({ status: 'abandoned', result_code: 'abandon' });
  });

  it('merges conflicting player_stage_progress rows and moves legacy-only rows', () => {
    const rows = afterFirst.progress as Row[];
    const of = (player: string, stage: string) => rows.find((r) => r.player_id === player && r.stage_id === stage)!;
    expect(rows.map((r) => [r.player_id, r.stage_id])).toEqual([
      ['no-profile', 'stage_04_core'],
      ['p1', 'stage_02_factory'], ['p2', 'stage_03_lab'], ['p3', 'stage_04_core'], ['p4', 'stage_04_core'],
      ['q-player', 'stage_01_ruins'], ['q-player', 'stage_02_factory'],
    ]);
    const p1 = of('p1', 'stage_02_factory');
    expect(p1).toMatchObject({ id: 'psp-1c', clear_count: 5, highest_boss_sequence: 2, best_clear_time_ms: 90000 });
    expect([iso(p1.unlocked_at), iso(p1.first_cleared_at), iso(p1.updated_at)])
      .toEqual([at('01-01').toISOString(), at('01-10').toISOString(), at('02-01').toISOString()]);
    expect(of('p2', 'stage_03_lab')).toMatchObject({ id: 'psp-2l', clear_count: 4, highest_boss_sequence: 1, best_clear_time_ms: 70000 });
    expect(of('p3', 'stage_04_core')).toMatchObject({ id: 'psp-3c', clear_count: 0, best_clear_time_ms: null });
    const p4 = of('p4', 'stage_04_core');
    expect(p4).toMatchObject({ id: 'psp-4c', clear_count: 6, highest_boss_sequence: 3, best_clear_time_ms: 100000 });
    expect([iso(p4.unlocked_at), iso(p4.first_cleared_at), iso(p4.updated_at)])
      .toEqual([at('01-09').toISOString(), at('02-01').toISOString(), at('03-02').toISOString()]);
    expect(of('no-profile', 'stage_04_core').id).toBe('psp-orphan');
  });

  it('re-keys userId-owned progress/records to profile.player_id and merges them', () => {
    const progress = afterFirst.progress as Row[];
    const records = afterFirst.records as Row[];
    expect(progress.some((r) => r.player_id === 'q-user')).toBe(false);
    expect(records.some((r) => r.player_id === 'q-user')).toBe(false);

    const merged = progress.find((r) => r.player_id === 'q-player' && r.stage_id === 'stage_02_factory')!;
    expect(merged).toMatchObject({ id: 'psp-qp-c', clear_count: 3, highest_boss_sequence: 2, best_clear_time_ms: 85000 });
    expect([iso(merged.unlocked_at), iso(merged.first_cleared_at), iso(merged.updated_at)])
      .toEqual([at('01-02').toISOString(), at('01-12').toISOString(), at('02-10').toISOString()]);
    // Existing clear on a stage without a canonical counterpart stays unlocked under the real player id.
    const ruins = progress.find((r) => r.player_id === 'q-player' && r.stage_id === 'stage_01_ruins')!;
    expect(ruins).toMatchObject({ id: 'psp-qu-r', clear_count: 7, best_clear_time_ms: 60000 });
    expect(iso(ruins.unlocked_at)).toBe(at('01-01').toISOString());

    const rec = records.find((r) => r.player_id === 'q-player' && r.stage_id === 'stage_02_factory')!;
    expect(rec).toMatchObject({ id: 'pr-qp-c', total_clears: 3, best_kill_count: 260, best_clear_time_sec: 70 });
    expect([iso(rec.first_cleared_at), iso(rec.last_cleared_at), iso(rec.updated_at)])
      .toEqual([at('01-05').toISOString(), at('02-11').toISOString(), at('02-11').toISOString()]);
  });

  it('merges conflicting player_records rows and moves legacy-only rows', () => {
    const rows = afterFirst.records as Row[];
    const of = (player: string, stage: string) => rows.find((r) => r.player_id === player && r.stage_id === stage)!;
    expect(rows.map((r) => [r.player_id, r.stage_id])).toEqual([
      ['p1', 'stage_02_factory'], ['p2', 'stage_03_lab'], ['p3', 'stage_04_core'], ['p4', 'stage_04_core'],
      ['q-player', 'stage_02_factory'],
    ]);
    const p1 = of('p1', 'stage_02_factory');
    expect(p1).toMatchObject({ id: 'pr-1c', total_clears: 5, best_kill_count: 300, best_clear_time_sec: 80 });
    expect([iso(p1.first_cleared_at), iso(p1.last_cleared_at), iso(p1.updated_at)])
      .toEqual([at('01-04').toISOString(), at('02-01').toISOString(), at('02-01').toISOString()]);
    expect(of('p2', 'stage_03_lab')).toMatchObject({ id: 'pr-2l', total_clears: 4, best_kill_count: 120, best_clear_time_sec: 60 });
    expect(of('p3', 'stage_04_core')).toMatchObject({ id: 'pr-3c', total_clears: 0, best_clear_time_sec: null });
    const p4 = of('p4', 'stage_04_core');
    expect(p4).toMatchObject({ id: 'pr-4c', total_clears: 3, best_kill_count: 50, best_clear_time_sec: 110 });
    expect([iso(p4.first_cleared_at), iso(p4.last_cleared_at), iso(p4.updated_at)])
      .toEqual([at('02-01').toISOString(), at('02-02').toISOString(), at('03-02').toISOString()]);
  });

  it('is idempotent: re-running the SQL changes nothing', () => {
    expect(afterSecond).toEqual(afterFirst);
  });
});

describe('battle-seed upsert after the migration', () => {
  it('preserves operator flags on existing stages and updates content and rewards', async () => {
    await withClient('stage_legacy', async (client) => {
      await client.query(`UPDATE game.stages SET enabled = 0 WHERE id = 'stage_03_lab'`);
      await client.query(`UPDATE game.stages SET unlocked = 1 WHERE id = 'stage_04_core'`);
      await client.query(`UPDATE game.stages SET name = 'stale', duration_seconds = 1 WHERE id = 'stage_01_ruins'`);
      await client.query(`UPDATE game.stage_rewards SET scrap_min = 1, scrap_max = 1, blueprint_drop_rate = 1 WHERE stage_id = 'stage_03_lab' AND clear_type = 'first'`);
    });

    await withPostgresConnection(url('stage_legacy'), seed);

    await withClient('stage_legacy', async (client) => {
      const stages = (await client.query('SELECT * FROM game.stages ORDER BY id')).rows as Row[];
      const byId = (id: string) => stages.find((s) => s.id === id)!;
      expect(byId('stage_03_lab').enabled).toBe(0);
      expect(byId('stage_04_core').unlocked).toBe(1);
      // Fixture rows kept the column default unlocked = 1; the old seed would have reset it to 0.
      expect(byId('stage_02_factory')).toMatchObject({ enabled: 1, unlocked: 1 });
      for (const def of STAGES) {
        expect(byId(def.id)).toMatchObject({ name: def.name, duration_seconds: def.durationSeconds, boss_timings: JSON.stringify(def.bossTimings) });
      }
      const reward = (await client.query(
        `SELECT scrap_min, scrap_max, blueprint_drop_rate FROM game.stage_rewards WHERE stage_id = 'stage_03_lab' AND clear_type = 'first'`)).rows;
      expect(reward).toEqual([{ scrap_min: 800, scrap_max: 1200, blueprint_drop_rate: 100 }]);
      const count = await client.query(`SELECT count(*)::int AS n FROM game.stage_rewards`);
      expect(count.rows[0].n).toBe(12); // 5 pre-existing rows are updated in place, 7 inserted
    });
  });

  it('inserts missing stages with default flags (only the first stage unlocked)', async () => {
    await withPostgresConnection(url('stage_full'), seed);
    await withClient('stage_full', async (client) => {
      const rows = (await client.query('SELECT id, unlocked, enabled FROM game.stages ORDER BY sequence')).rows;
      expect(rows).toEqual([
        { id: 'stage_01_ruins', unlocked: 1, enabled: 1 },
        { id: 'stage_02_factory', unlocked: 0, enabled: 1 },
        { id: 'stage_03_lab', unlocked: 0, enabled: 1 },
        { id: 'stage_04_core', unlocked: 0, enabled: 1 },
      ]);
    });
  });
});
