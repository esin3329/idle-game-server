-- Migration: crafting system (0004_crafting.sql)
CREATE TABLE IF NOT EXISTS `player_blueprints` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `blueprint_code` varchar(50) NOT NULL,
  `acquired_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pb_player_code` (`player_id`, `blueprint_code`),
  INDEX `idx_pb_player_id` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
