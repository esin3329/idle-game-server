-- Migration: research system (0003_research.sql)
-- npm run db:migrate 로 실행

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
