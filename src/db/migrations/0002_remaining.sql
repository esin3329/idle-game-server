-- Migration: remaining tables (admin, parts, research, crafting) (0002_remaining.sql)
-- npm run db:migrate 로 실행

-- ═══════════════════════════════════════════════════
-- ALTER: 누락된 users 컬럼 추가
-- ═══════════════════════════════════════════════════

ALTER TABLE `users`
  ADD COLUMN `role` varchar(20) NOT NULL DEFAULT 'user';
--> statement-breakpoint

ALTER TABLE `users`
  ADD COLUMN `suspended_at` datetime;
--> statement-breakpoint

ALTER TABLE `users`
  ADD COLUMN `suspended_reason` varchar(200);
--> statement-breakpoint

-- ═══════════════════════════════════════════════════
-- ALTER: 누락된 battle_sessions 컬럼 추가
-- ═══════════════════════════════════════════════════

ALTER TABLE `battle_sessions`
  ADD COLUMN `user_id` varchar(36) NOT NULL DEFAULT '';
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `current_core_energy` int NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `current_level` int NOT NULL DEFAULT 1;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `total_kills` int NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `scrap_earned_in_session` int NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `highest_boss_sequence` int NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `loadout_snapshot` varchar(2000) NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `research_snapshot` varchar(2000) NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `base_stats_snapshot` varchar(2000) NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `random_seed` varchar(64) NOT NULL DEFAULT '';
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `last_event_at` datetime;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `expires_at` datetime;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `completed_at` datetime;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `current_elapsed_ms` int NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE `battle_sessions`
  ADD COLUMN `result_code` varchar(50);

--> statement-breakpoint

-- ═══════════════════════════════════════════════════
-- 운영자 권한·감사 테이블
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `operator_roles` (
  `id` varchar(36) NOT NULL,
  `name` varchar(50) NOT NULL,
  `code` varchar(20) NOT NULL,
  `description` varchar(200) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_or_name` (`name`),
  UNIQUE KEY `uq_or_code` (`code`),
  INDEX `idx_or_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operator_permissions` (
  `id` varchar(36) NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` varchar(200) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_op_code` (`code`),
  INDEX `idx_op_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operator_role_permissions` (
  `id` varchar(36) NOT NULL,
  `role_id` varchar(36) NOT NULL,
  `permission_id` varchar(36) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orp_role_perm` (`role_id`, `permission_id`),
  INDEX `idx_orp_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operator_account_roles` (
  `id` varchar(36) NOT NULL,
  `operator_account_id` varchar(36) NOT NULL,
  `role_id` varchar(36) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oar_account_role` (`operator_account_id`, `role_id`),
  INDEX `idx_oar_account` (`operator_account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operator_accounts` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `role_id` varchar(36) NOT NULL DEFAULT '',
  `granted_by` varchar(36) NOT NULL DEFAULT '',
  `granted_at` datetime,
  `revoked_at` datetime,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oa_user_id` (`user_id`),
  INDEX `idx_oa_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operator_audit_logs` (
  `id` varchar(36) NOT NULL,
  `operator_id` varchar(36) NOT NULL,
  `action` varchar(50) NOT NULL,
  `target_type` varchar(20) NOT NULL DEFAULT '',
  `target_id` varchar(36) NOT NULL DEFAULT '',
  `reason_code` varchar(50) NOT NULL DEFAULT '',
  `reason_text` varchar(200) NOT NULL DEFAULT '',
  `before_summary` varchar(500) NOT NULL DEFAULT '{}',
  `after_summary` varchar(500) NOT NULL DEFAULT '{}',
  `result` varchar(20) NOT NULL DEFAULT 'success',
  `detail` varchar(1000) NOT NULL DEFAULT '{}',
  `request_id` varchar(36) NOT NULL DEFAULT '',
  `ip_hash` varchar(64) NOT NULL DEFAULT '',
  `user_agent_summary` varchar(100) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_oal_operator` (`operator_id`),
  INDEX `idx_oal_action` (`action`),
  INDEX `idx_oal_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `account_sanctions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `operator_id` varchar(36) NOT NULL,
  `revoked_by_operator_id` varchar(36),
  `revoked_at` datetime,
  `revoke_reason` varchar(200),
  `type` varchar(20) NOT NULL,
  `reason_code` varchar(50) NOT NULL DEFAULT '',
  `reason_text` varchar(200) NOT NULL,
  `starts_at` datetime NOT NULL,
  `expires_at` datetime,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_as_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operator_grants` (
  `id` varchar(36) NOT NULL,
  `target_user_id` varchar(36) NOT NULL,
  `operator_id` varchar(36) NOT NULL,
  `grant_type` varchar(50) NOT NULL,
  `resource_code` varchar(20) NOT NULL,
  `amount` int NOT NULL,
  `reason_code` varchar(50) NOT NULL DEFAULT '',
  `reason_text` varchar(200) NOT NULL,
  `external_reference` varchar(200) NOT NULL DEFAULT '',
  `status` varchar(20) NOT NULL DEFAULT 'completed',
  `idempotency_key` varchar(64) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_og_idempotency` (`idempotency_key`),
  INDEX `idx_og_target_user` (`target_user_id`),
  INDEX `idx_og_operator` (`operator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `security_events` (
  `id` varchar(36) NOT NULL,
  `event_type` varchar(50) NOT NULL,
  `user_id` varchar(36),
  `player_id` varchar(36),
  `session_id` varchar(36),
  `code` varchar(50) NOT NULL DEFAULT '',
  `severity` varchar(10) NOT NULL DEFAULT 'warn',
  `source` varchar(50) NOT NULL DEFAULT '',
  `reference_type` varchar(50) NOT NULL DEFAULT '',
  `reference_id` varchar(36) NOT NULL DEFAULT '',
  `detail` varchar(1000) NOT NULL DEFAULT '{}',
  `safe_details` varchar(1000) NOT NULL DEFAULT '{}',
  `request_id` varchar(36) NOT NULL DEFAULT '',
  `occurred_at` datetime NOT NULL,
  `reviewed_at` datetime,
  `reviewed_by_operator_id` varchar(36),
  `resolution` varchar(50) NOT NULL DEFAULT '',
  `resolution_note` varchar(200) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_se_user_id` (`user_id`),
  INDEX `idx_se_event_type` (`event_type`),
  INDEX `idx_se_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

-- ═══════════════════════════════════════════════════
-- 파츠·메카 구성
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `parts_inventory` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `part_code` varchar(50) NOT NULL,
  `part_type` varchar(10) NOT NULL,
  `level` int NOT NULL DEFAULT 1,
  `equipped` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pi_player_code` (`player_id`, `part_code`),
  INDEX `idx_pi_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `equip_slots` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `frame` varchar(50) NOT NULL DEFAULT 'medium_frame',
  `weapon` varchar(50) NOT NULL DEFAULT 'machine_gun',
  `core` varchar(50) NOT NULL DEFAULT 'assault_core',
  `module` varchar(50) NOT NULL DEFAULT 'power_module',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_es_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `mecha_configs` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `name` varchar(50) NOT NULL DEFAULT '기본 구성',
  `frame` varchar(50) NOT NULL DEFAULT 'medium_frame',
  `weapon` varchar(50) NOT NULL DEFAULT 'machine_gun',
  `core` varchar(50) NOT NULL DEFAULT 'assault_core',
  `module` varchar(50) NOT NULL DEFAULT 'power_module',
  `is_active` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_mc_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

-- ═══════════════════════════════════════════════════
-- 연구·제작
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `player_research` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `code` varchar(50) NOT NULL,
  `level` int NOT NULL DEFAULT 0,
  `completed` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pr_player_code` (`player_id`, `code`),
  INDEX `idx_pr_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `player_blueprints` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `blueprint_code` varchar(50) NOT NULL,
  `acquired_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pb_player_code` (`player_id`, `blueprint_code`),
  INDEX `idx_pb_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `crafting_queue` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `result_code` varchar(50) NOT NULL,
  `materials` varchar(500) NOT NULL DEFAULT '{}',
  `started_at` datetime NOT NULL,
  `completes_at` datetime NOT NULL,
  `completed` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_cq_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

-- ═══════════════════════════════════════════════════
-- ALTER: stage_rewards에 core_per_kill, core_per_level 추가
-- ═══════════════════════════════════════════════════

ALTER TABLE `stages`
  ADD COLUMN `core_per_kill` int NOT NULL DEFAULT 5;
--> statement-breakpoint

ALTER TABLE `stages`
  ADD COLUMN `core_per_level` int NOT NULL DEFAULT 50;
