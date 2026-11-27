-- Normalize legacy stage IDs to canonical IDs (see docs/STAGE_MIGRATION.md).
--   stage_02_canyon   -> stage_02_factory
--   stage_03_furnace  -> stage_03_lab
--   stage_04_fortress -> stage_04_core
--
-- Idempotent: once no legacy IDs remain every statement matches zero rows.
-- Runs inside the transaction opened by postgres-migrate.ts, so no BEGIN/COMMIT here.
-- game.* tables carry no foreign keys on stage_id, so ordering is only about unique-key collisions.
-- Note: LEAST/GREATEST ignore NULL arguments in PostgreSQL (NULL only if all arguments are NULL).

DO $$
DECLARE
  legacy_ids    text[] := ARRAY['stage_02_canyon', 'stage_03_furnace', 'stage_04_fortress'];
  canonical_ids text[] := ARRAY['stage_02_factory', 'stage_03_lab', 'stage_04_core'];
  legacy_id     text;
  canonical_id  text;
  i             integer;
BEGIN
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

    -- stage_bosses: drop legacy rows duplicating a canonical (sequence | boss_code), move the rest.
    DELETE FROM game.stage_bosses l
     WHERE l.stage_id = legacy_id
       AND EXISTS (
         SELECT 1 FROM game.stage_bosses c
          WHERE c.stage_id = canonical_id
            AND (c.sequence = l.sequence OR c.boss_code = l.boss_code)
       );
    UPDATE game.stage_bosses SET stage_id = canonical_id WHERE stage_id = legacy_id;

    -- stage_rewards: one row per (stage, clear_type).
    DELETE FROM game.stage_rewards l
     WHERE l.stage_id = legacy_id
       AND EXISTS (
         SELECT 1 FROM game.stage_rewards c
          WHERE c.stage_id = canonical_id AND c.clear_type = l.clear_type
       );
    UPDATE game.stage_rewards SET stage_id = canonical_id WHERE stage_id = legacy_id;

    -- battle_sessions: no uniqueness on stage_id.
    UPDATE game.battle_sessions SET stage_id = canonical_id WHERE stage_id = legacy_id;

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
END $$;
