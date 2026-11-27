-- Normalize legacy stage IDs to canonical IDs (see docs/STAGE_MIGRATION.md).
--   stage_02_canyon   -> stage_02_factory
--   stage_03_furnace  -> stage_03_lab
--   stage_04_fortress -> stage_04_core
--
-- Idempotent: once no legacy IDs / userId-keyed rows remain every statement matches zero rows.
-- Runs inside the transaction opened by postgres-migrate.ts, so no BEGIN/COMMIT here.
-- game.* tables carry no foreign keys on stage_id, so ordering is only about unique-key collisions.
-- Note: LEAST/GREATEST ignore NULL arguments in PostgreSQL (NULL only if all arguments are NULL).
--
-- Steps:
--   1. Re-key player_stage_progress / player_records rows stored under user_id to profile.player_id.
--   2. Per legacy stage: abandon in-flight sessions, then rewrite every referencing table.
--   3. Deterministically deduplicate stage_bosses / stage_rewards.
--   4. Sync canonical stage metadata (mirrors src/data/stages.ts) so boss_timings/duration match
--      the canonical boss lists even before `npm run db:battle-seed` runs.
-- Unique indexes on stage_bosses / stage_rewards are created after the DO block.

DO $$
DECLARE
  legacy_ids    text[] := ARRAY['stage_02_canyon', 'stage_03_furnace', 'stage_04_fortress'];
  canonical_ids text[] := ARRAY['stage_02_factory', 'stage_03_lab', 'stage_04_core'];
  legacy_id     text;
  canonical_id  text;
  i             integer;
BEGIN
  -- 1. Some rows were written with player_id = users.id. Map each such user to its single profile.player_id.
  DROP TABLE IF EXISTS pg_temp.stage_migration_player_map;
  CREATE TEMP TABLE stage_migration_player_map ON COMMIT DROP AS
    SELECT p.user_id AS from_id, min(p.player_id) AS to_id
      FROM game.player_profiles p
     WHERE p.user_id <> p.player_id
       AND p.user_id NOT IN (SELECT player_id FROM game.player_profiles)
     GROUP BY p.user_id
    HAVING count(*) = 1;

  UPDATE game.player_stage_progress c
     SET clear_count           = c.clear_count + l.clear_count,
         highest_boss_sequence = GREATEST(c.highest_boss_sequence, l.highest_boss_sequence),
         best_clear_time_ms    = LEAST(c.best_clear_time_ms, l.best_clear_time_ms),
         first_cleared_at      = LEAST(c.first_cleared_at, l.first_cleared_at),
         unlocked_at           = LEAST(c.unlocked_at, l.unlocked_at),
         updated_at            = GREATEST(c.updated_at, l.updated_at)
    FROM game.player_stage_progress l
    JOIN stage_migration_player_map m ON m.from_id = l.player_id
   WHERE c.player_id = m.to_id
     AND c.stage_id = l.stage_id;
  DELETE FROM game.player_stage_progress l
   USING stage_migration_player_map m
   WHERE l.player_id = m.from_id
     AND EXISTS (
       SELECT 1 FROM game.player_stage_progress c
        WHERE c.player_id = m.to_id AND c.stage_id = l.stage_id
     );
  UPDATE game.player_stage_progress l
     SET player_id = m.to_id
    FROM stage_migration_player_map m
   WHERE l.player_id = m.from_id;

  UPDATE game.player_records c
     SET total_clears        = c.total_clears + l.total_clears,
         best_kill_count     = GREATEST(c.best_kill_count, l.best_kill_count),
         best_clear_time_sec = LEAST(c.best_clear_time_sec, l.best_clear_time_sec),
         first_cleared_at    = LEAST(c.first_cleared_at, l.first_cleared_at),
         last_cleared_at     = GREATEST(c.last_cleared_at, l.last_cleared_at),
         updated_at          = GREATEST(c.updated_at, l.updated_at)
    FROM game.player_records l
    JOIN stage_migration_player_map m ON m.from_id = l.player_id
   WHERE c.player_id = m.to_id
     AND c.stage_id = l.stage_id;
  DELETE FROM game.player_records l
   USING stage_migration_player_map m
   WHERE l.player_id = m.from_id
     AND EXISTS (
       SELECT 1 FROM game.player_records c
        WHERE c.player_id = m.to_id AND c.stage_id = l.stage_id
     );
  UPDATE game.player_records l
     SET player_id = m.to_id
    FROM stage_migration_player_map m
   WHERE l.player_id = m.from_id;

  -- 2. Legacy -> canonical stage IDs.
  FOR i IN 1 .. array_length(legacy_ids, 1) LOOP
    legacy_id := legacy_ids[i];
    canonical_id := canonical_ids[i];

    -- stages: rewrite prerequisite references, then rename or drop the legacy row.
    UPDATE game.stages
       SET entry_requirement = replace(entry_requirement, legacy_id, canonical_id)
     WHERE position(legacy_id IN entry_requirement) > 0;

    IF EXISTS (SELECT 1 FROM game.stages WHERE id = canonical_id) THEN
      DELETE FROM game.stages WHERE id = legacy_id;
    ELSE
      UPDATE game.stages SET id = canonical_id WHERE id = legacy_id;
    END IF;

    -- battle_sessions: in-flight sessions were created under the legacy stage's boss/duration rules
    -- (e.g. 540s / 3 bosses) and would fail the canonical checks, so close them before retargeting.
    -- 'completing' is included because a failed finalize reverts it to 'active' (battle-session.ts).
    UPDATE game.battle_sessions
       SET status       = 'abandoned',
           result_code  = 'STAGE_MIGRATION_RESET',
           end_time     = COALESCE(end_time, CURRENT_TIMESTAMP),
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
           updated_at   = CURRENT_TIMESTAMP
     WHERE stage_id = legacy_id
       AND status IN ('active', 'completing');
    UPDATE game.battle_sessions SET stage_id = canonical_id WHERE stage_id = legacy_id;

    -- stage_bosses: drop legacy rows duplicating a canonical (sequence | boss_code), move the rest.
    DELETE FROM game.stage_bosses l
     WHERE l.stage_id = legacy_id
       AND EXISTS (
         SELECT 1 FROM game.stage_bosses c
          WHERE c.stage_id = canonical_id
            AND (c.sequence = l.sequence OR c.boss_code = l.boss_code)
       );
    UPDATE game.stage_bosses SET stage_id = canonical_id WHERE stage_id = legacy_id;

    -- stage_rewards: one row per (stage, clear_type); canonical values win.
    DELETE FROM game.stage_rewards l
     WHERE l.stage_id = legacy_id
       AND EXISTS (
         SELECT 1 FROM game.stage_rewards c
          WHERE c.stage_id = canonical_id AND c.clear_type = l.clear_type
       );
    UPDATE game.stage_rewards SET stage_id = canonical_id WHERE stage_id = legacy_id;

    -- player_stage_progress: merge into the canonical row when both exist (uq_psp_player_stage).
    UPDATE game.player_stage_progress c
       SET clear_count           = c.clear_count + l.clear_count,
           highest_boss_sequence = GREATEST(c.highest_boss_sequence, l.highest_boss_sequence),
           best_clear_time_ms    = LEAST(c.best_clear_time_ms, l.best_clear_time_ms),
           first_cleared_at      = LEAST(c.first_cleared_at, l.first_cleared_at),
           unlocked_at           = LEAST(c.unlocked_at, l.unlocked_at),
           updated_at            = GREATEST(c.updated_at, l.updated_at)
      FROM game.player_stage_progress l
     WHERE l.stage_id = legacy_id
       AND c.stage_id = canonical_id
       AND c.player_id = l.player_id;
    DELETE FROM game.player_stage_progress l
     WHERE l.stage_id = legacy_id
       AND EXISTS (
         SELECT 1 FROM game.player_stage_progress c
          WHERE c.stage_id = canonical_id AND c.player_id = l.player_id
       );
    UPDATE game.player_stage_progress SET stage_id = canonical_id WHERE stage_id = legacy_id;

    -- player_records: same merge strategy (uq_pr_player_stage).
    UPDATE game.player_records c
       SET total_clears        = c.total_clears + l.total_clears,
           best_kill_count     = GREATEST(c.best_kill_count, l.best_kill_count),
           best_clear_time_sec = LEAST(c.best_clear_time_sec, l.best_clear_time_sec),
           first_cleared_at    = LEAST(c.first_cleared_at, l.first_cleared_at),
           last_cleared_at     = GREATEST(c.last_cleared_at, l.last_cleared_at),
           updated_at          = GREATEST(c.updated_at, l.updated_at)
      FROM game.player_records l
     WHERE l.stage_id = legacy_id
       AND c.stage_id = canonical_id
       AND c.player_id = l.player_id;
    DELETE FROM game.player_records l
     WHERE l.stage_id = legacy_id
       AND EXISTS (
         SELECT 1 FROM game.player_records c
          WHERE c.stage_id = canonical_id AND c.player_id = l.player_id
       );
    UPDATE game.player_records SET stage_id = canonical_id WHERE stage_id = legacy_id;
  END LOOP;

  -- 3. Deterministic dedup (earliest created_at, then smallest id wins).
  DELETE FROM game.stage_bosses d
   USING (
     SELECT id, row_number() OVER (PARTITION BY stage_id, sequence, boss_code ORDER BY created_at, id) AS rn
       FROM game.stage_bosses
   ) r
   WHERE d.id = r.id AND r.rn > 1;
  DELETE FROM game.stage_rewards d
   USING (
     SELECT id, row_number() OVER (PARTITION BY stage_id, clear_type ORDER BY created_at, id) AS rn
       FROM game.stage_rewards
   ) r
   WHERE d.id = r.id AND r.rn > 1;

  -- 4. Sync canonical stage metadata from src/data/stages.ts (only on databases that hold stage content;
  --    `unlocked`/`enabled` of existing rows are left untouched).
  IF EXISTS (SELECT 1 FROM game.stages) THEN
    INSERT INTO game.stages (
      id, name, description, sequence, entry_requirement, duration_seconds, recommended_power,
      enemy_set, boss_timings, max_kills, max_core_energy, core_per_level, core_per_kill,
      scrap_per_kill, unlocked, enabled, content_version, created_at
    ) VALUES
      ('stage_02_factory', '공장', '자동화 설비가 여전히 가동 중인 공장. 기계형 적이 주를 이룬다.', 2, 'stage_01_ruins', 180, 30,
       '["드론","경비로봇","컨베이어"]', '[90,150]', 400, 400, 60, 6, 2, 0, 1, '1.0.0', CURRENT_TIMESTAMP),
      ('stage_03_lab', '연구소', '금단의 실험이 자행되던 비밀 연구소. 돌연변이와 방어 시스템이 기다린다.', 3, 'stage_02_factory', 360, 60,
       '["돌연변이","실험체","방어드론"]', '[240,300]', 500, 500, 70, 7, 3, 0, 1, '1.0.0', CURRENT_TIMESTAMP),
      ('stage_04_core', '코어', '모든 것의 중심, AI 코어. 최종 보스 오버마인드가 기다리고 있다.', 4, 'stage_03_lab', 360, 100,
       '["엘리트 경비병","AI 병사","차원 왜곡체"]', '[180,270,330]', 600, 600, 80, 8, 4, 0, 1, '1.0.0', CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      name              = EXCLUDED.name,
      description       = EXCLUDED.description,
      sequence          = EXCLUDED.sequence,
      entry_requirement = EXCLUDED.entry_requirement,
      duration_seconds  = EXCLUDED.duration_seconds,
      recommended_power = EXCLUDED.recommended_power,
      enemy_set         = EXCLUDED.enemy_set,
      boss_timings      = EXCLUDED.boss_timings,
      max_kills         = EXCLUDED.max_kills,
      max_core_energy   = EXCLUDED.max_core_energy,
      core_per_level    = EXCLUDED.core_per_level,
      core_per_kill     = EXCLUDED.core_per_kill,
      scrap_per_kill    = EXCLUDED.scrap_per_kill,
      content_version   = EXCLUDED.content_version;
  END IF;
END $$;

-- Created only after deduplication above.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sr_stage_clear_type ON game.stage_rewards (stage_id, clear_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sb_stage_sequence_boss ON game.stage_bosses (stage_id, sequence, boss_code);
