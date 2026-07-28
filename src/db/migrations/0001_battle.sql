-- Migration: battle system tables (0001_battle.sql)
-- npm run db:migrate 로 실행

CREATE TABLE IF NOT EXISTS `stages` (
  `id` varchar(36) NOT NULL,
  `name` varchar(50) NOT NULL,
  `description` varchar(200) NOT NULL DEFAULT '',
  `sequence` int NOT NULL DEFAULT 1,
  `duration_seconds` int NOT NULL,
  `entry_requirement` varchar(100) NOT NULL DEFAULT 'none',
  `recommended_power` int NOT NULL DEFAULT 10,
  `enemy_set` varchar(200) NOT NULL DEFAULT '[]',
  `boss_timings` varchar(100) NOT NULL DEFAULT '[180,360]',
  `max_kills` int NOT NULL DEFAULT 300,
  `max_core_energy` int NOT NULL DEFAULT 300,
  `scrap_per_kill` int NOT NULL DEFAULT 1,
  `unlocked` int NOT NULL DEFAULT 1,
  `enabled` int NOT NULL DEFAULT 1,
  `content_version` varchar(20) NOT NULL DEFAULT '1.0.0',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_stages_unlocked` (`unlocked`),
  INDEX `idx_stages_sequence` (`sequence`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stage_rewards` (
  `id` varchar(36) NOT NULL,
  `stage_id` varchar(36) NOT NULL,
  `clear_type` varchar(20) NOT NULL DEFAULT 'normal',
  `scrap_min` int NOT NULL DEFAULT 0,
  `scrap_max` int NOT NULL DEFAULT 0,
  `blueprint_drop_rate` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_sr_stage_id` (`stage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mecha_stats` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `attack_power` int NOT NULL DEFAULT 10,
  `attack_speed` int NOT NULL DEFAULT 100,
  `move_speed` int NOT NULL DEFAULT 100,
  `dash_cooldown` int NOT NULL DEFAULT 5000,
  `ultimate_power` int NOT NULL DEFAULT 30,
  `ultimate_cooldown` int NOT NULL DEFAULT 30000,
  `max_hp` int NOT NULL DEFAULT 100,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ms_player_id` (`player_id`),
  INDEX `idx_ms_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `battle_sessions` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `stage_id` varchar(36) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `core_energy` int NOT NULL DEFAULT 0,
  `battle_level` int NOT NULL DEFAULT 1,
  `kills_reported` int NOT NULL DEFAULT 0,
  `scrap_accumulated` int NOT NULL DEFAULT 0,
  `upgrades_applied` varchar(1000) NOT NULL DEFAULT '[]',
  `offered_choices` varchar(1000) NOT NULL DEFAULT '[]',
  `boss_defeated` varchar(100) NOT NULL DEFAULT '[]',
  `stat_snapshot` varchar(2000) NOT NULL DEFAULT '{}',
  `session_seed` varchar(64) NOT NULL DEFAULT '',
  `content_version` varchar(20) NOT NULL DEFAULT '1.0.0',
  `start_time` datetime NOT NULL,
  `end_time` datetime,
  `verified_at` datetime,
  `reward_scrap` int NOT NULL DEFAULT 0,
  `reward_blueprint` varchar(36),
  `reward_part` varchar(36),
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_bs_player_id` (`player_id`),
  INDEX `idx_bs_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `player_records` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `stage_id` varchar(36) NOT NULL,
  `best_clear_time_sec` int,
  `best_kill_count` int NOT NULL DEFAULT 0,
  `total_clears` int NOT NULL DEFAULT 0,
  `first_cleared_at` datetime,
  `last_cleared_at` datetime,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pr_player_stage` (`player_id`, `stage_id`),
  INDEX `idx_pr_player_stage` (`player_id`, `stage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stage_bosses` (
  `id` varchar(36) NOT NULL,
  `stage_id` varchar(36) NOT NULL,
  `boss_code` varchar(50) NOT NULL,
  `sequence` int NOT NULL DEFAULT 1,
  `checkpoint_seconds` int NOT NULL,
  `reward_definition` varchar(500) NOT NULL DEFAULT '{}',
  `enabled` int NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_sb_stage_id` (`stage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `battle_events` (
  `id` varchar(36) NOT NULL,
  `battle_session_id` varchar(36) NOT NULL,
  `sequence` int NOT NULL DEFAULT 1,
  `event_type` varchar(50) NOT NULL,
  `elapsed_ms` int NOT NULL DEFAULT 0,
  `payload` varchar(2000) NOT NULL DEFAULT '{}',
  `idempotency_key` varchar(64) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_be_session_seq` (`battle_session_id`, `sequence`),
  INDEX `idx_be_session_id` (`battle_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `battle_upgrade_offers` (
  `id` varchar(36) NOT NULL,
  `battle_session_id` varchar(36) NOT NULL,
  `level` int NOT NULL DEFAULT 1,
  `sequence` int NOT NULL DEFAULT 1,
  `option_slot` int NOT NULL DEFAULT 0,
  `upgrade_id` varchar(36) NOT NULL,
  `selected` int NOT NULL DEFAULT 0,
  `selected_at` datetime,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_buo_session_level` (`battle_session_id`, `level`),
  INDEX `idx_buo_session_id` (`battle_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `battle_results` (
  `id` varchar(36) NOT NULL,
  `battle_session_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `result` varchar(20) NOT NULL,
  `is_first_clear` int NOT NULL DEFAULT 0,
  `verified_elapsed_ms` int NOT NULL DEFAULT 0,
  `verified_kills` int NOT NULL DEFAULT 0,
  `verified_boss_sequence` int NOT NULL DEFAULT 0,
  `scrap_reward` int NOT NULL DEFAULT 0,
  `reward_summary` varchar(500) NOT NULL DEFAULT '{}',
  `finalized_at` datetime,
  `idempotency_key` varchar(64) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_br_session_id` (`battle_session_id`),
  INDEX `idx_br_session_id` (`battle_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `player_stage_progress` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `stage_id` varchar(36) NOT NULL,
  `unlocked_at` datetime,
  `first_cleared_at` datetime,
  `best_clear_time_ms` int,
  `highest_boss_sequence` int NOT NULL DEFAULT 0,
  `clear_count` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_psp_player_stage` (`player_id`, `stage_id`),
  INDEX `idx_psp_player_stage` (`player_id`, `stage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `item_ledger` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `item_type` varchar(20) NOT NULL,
  `item_id` varchar(50) NOT NULL,
  `quantity` int NOT NULL DEFAULT 1,
  `source` varchar(50) NOT NULL,
  `reference_type` varchar(50) NOT NULL DEFAULT '',
  `reference_id` varchar(36) NOT NULL DEFAULT '',
  `idempotency_key` varchar(64) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_il_player_id` (`player_id`),
  INDEX `idx_il_user_id` (`user_id`),
  UNIQUE KEY `uq_il_idempotency` (`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
