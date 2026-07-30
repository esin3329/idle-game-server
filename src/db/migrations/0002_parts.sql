-- Migration: parts system (0002_parts.sql)
-- npm run db:migrate 로 실행

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
