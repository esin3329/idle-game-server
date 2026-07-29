-- drizzle-kit generate output
-- npm run db:migrate 로 실행

CREATE TABLE IF NOT EXISTS `players` (
  `id` varchar(36) NOT NULL,
  `nickname` varchar(20) NOT NULL,
  `api_key` varchar(36) NOT NULL,
  `electricity` int NOT NULL DEFAULT 0,
  `electricity_per_second` int NOT NULL DEFAULT 1,
  `last_claimed_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_players_api_key` (`api_key`),
  INDEX `idx_players_electricity` (`electricity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `users` (
  `id` varchar(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `nickname` varchar(20) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `refresh_token` varchar(512),
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_nickname` (`nickname`),
  INDEX `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `refresh_sessions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `token_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_rs_user_id` (`user_id`),
  INDEX `idx_rs_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `wallet_balances` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `currency` varchar(20) NOT NULL DEFAULT 'electricity',
  `electricity` int NOT NULL DEFAULT 0,
  `electricity_per_second` int NOT NULL DEFAULT 1,
  `scrap` int NOT NULL DEFAULT 0,
  `balance` int NOT NULL DEFAULT 0,
  `last_claimed_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wb_player_id` (`player_id`),
  UNIQUE KEY `uq_wb_user_currency` (`user_id`, `currency`),
  INDEX `idx_wb_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `currency_ledger` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `currency` varchar(20) NOT NULL DEFAULT 'electricity',
  `amount` int NOT NULL,
  `balance_after` int NOT NULL,
  `source` varchar(50) NOT NULL,
  `reason` varchar(100) NOT NULL DEFAULT '',
  `reference_type` varchar(50) NOT NULL DEFAULT '',
  `reference_id` varchar(36) NOT NULL DEFAULT '',
  `idempotency_key` varchar(64) NOT NULL DEFAULT '',
  `request_hash` varchar(64) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cl_idempotency` (`idempotency_key`),
  INDEX `idx_cl_player_id` (`player_id`),
  INDEX `idx_cl_user_id` (`user_id`),
  INDEX `idx_cl_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `player_profiles` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `nickname` varchar(20) NOT NULL,
  `highest_stage` int NOT NULL DEFAULT 1,
  `display_name` varchar(30),
  `avatar_url` varchar(512),
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pp_player_id` (`player_id`),
  INDEX `idx_pp_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
