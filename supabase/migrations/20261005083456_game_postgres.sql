CREATE SCHEMA IF NOT EXISTS "game";
--> statement-breakpoint
CREATE TABLE "game"."account_sanctions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"operator_id" varchar(36) NOT NULL,
	"revoked_by_operator_id" varchar(36),
	"revoked_at" timestamp (3) with time zone,
	"revoke_reason" varchar(200),
	"type" varchar(20) NOT NULL,
	"reason_code" varchar(50) DEFAULT '' NOT NULL,
	"reason_text" varchar(200) NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."ai_runs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"operator_id" varchar(36) NOT NULL,
	"target_user_id" varchar(36) NOT NULL,
	"case_type" varchar(40) NOT NULL,
	"input_json" text NOT NULL,
	"provider" varchar(24) NOT NULL,
	"model" varchar(255) NOT NULL,
	"status" varchar(20) NOT NULL,
	"active_operator_id" varchar(36),
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"prompt_version" varchar(32) NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	"deadline_at" timestamp (3) with time zone NOT NULL,
	"elapsed_ms" integer,
	"result_json" text,
	"error_code" varchar(64),
	"token_usage_json" text,
	CONSTRAINT "uq_ai_runs_operator_idempotency" UNIQUE("operator_id","idempotency_key"),
	CONSTRAINT "uq_ai_runs_active_operator" UNIQUE("active_operator_id")
);
--> statement-breakpoint
CREATE TABLE "game"."ai_tool_calls" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"run_id" varchar(36) NOT NULL,
	"sequence" integer NOT NULL,
	"tool_name" varchar(64) NOT NULL,
	"sanitized_args" text NOT NULL,
	"evidence_json" text,
	"elapsed_ms" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"error_code" varchar(64),
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_ai_tool_calls_run_sequence" UNIQUE("run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "game"."battle_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"battle_session_id" varchar(36) NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"elapsed_ms" integer DEFAULT 0 NOT NULL,
	"payload" varchar(2000) DEFAULT '{}' NOT NULL,
	"idempotency_key" varchar(64) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_be_session_seq" UNIQUE("battle_session_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "game"."battle_results" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"battle_session_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"result" varchar(20) NOT NULL,
	"is_first_clear" integer DEFAULT 0 NOT NULL,
	"verified_elapsed_ms" integer DEFAULT 0 NOT NULL,
	"verified_kills" integer DEFAULT 0 NOT NULL,
	"verified_boss_sequence" integer DEFAULT 0 NOT NULL,
	"scrap_reward" integer DEFAULT 0 NOT NULL,
	"reward_summary" varchar(500) DEFAULT '{}' NOT NULL,
	"finalized_at" timestamp (3) with time zone,
	"idempotency_key" varchar(64) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "battle_results_battle_session_id_unique" UNIQUE("battle_session_id")
);
--> statement-breakpoint
CREATE TABLE "game"."battle_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"user_id" varchar(36) DEFAULT '' NOT NULL,
	"stage_id" varchar(36) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"core_energy" integer DEFAULT 0 NOT NULL,
	"current_core_energy" integer DEFAULT 0 NOT NULL,
	"battle_level" integer DEFAULT 1 NOT NULL,
	"current_level" integer DEFAULT 1 NOT NULL,
	"kills_reported" integer DEFAULT 0 NOT NULL,
	"total_kills" integer DEFAULT 0 NOT NULL,
	"scrap_accumulated" integer DEFAULT 0 NOT NULL,
	"scrap_earned_in_session" integer DEFAULT 0 NOT NULL,
	"upgrades_applied" varchar(1000) DEFAULT '[]' NOT NULL,
	"offered_choices" varchar(1000) DEFAULT '[]' NOT NULL,
	"boss_defeated" varchar(100) DEFAULT '[]' NOT NULL,
	"highest_boss_sequence" integer DEFAULT 0 NOT NULL,
	"stat_snapshot" varchar(2000) DEFAULT '{}' NOT NULL,
	"loadout_snapshot" varchar(2000) DEFAULT '{}' NOT NULL,
	"research_snapshot" varchar(2000) DEFAULT '{}' NOT NULL,
	"base_stats_snapshot" varchar(2000) DEFAULT '{}' NOT NULL,
	"session_seed" varchar(64) DEFAULT '' NOT NULL,
	"random_seed" varchar(64) DEFAULT '' NOT NULL,
	"content_version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"start_time" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"last_event_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone,
	"end_time" timestamp (3) with time zone,
	"completed_at" timestamp (3) with time zone,
	"current_elapsed_ms" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp (3) with time zone,
	"result_code" varchar(50),
	"reward_scrap" integer DEFAULT 0 NOT NULL,
	"reward_blueprint" varchar(36),
	"reward_part" varchar(36),
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."battle_upgrade_offers" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"battle_session_id" varchar(36) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"option_slot" integer DEFAULT 0 NOT NULL,
	"upgrade_id" varchar(36) NOT NULL,
	"selected" integer DEFAULT 0 NOT NULL,
	"selected_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_buo_session_level" UNIQUE("battle_session_id","level")
);
--> statement-breakpoint
CREATE TABLE "game"."crafting_queue" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"result_code" varchar(50) NOT NULL,
	"materials" varchar(500) DEFAULT '{}' NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"completes_at" timestamp (3) with time zone NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."currency_ledger" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"currency" varchar(20) DEFAULT 'electricity' NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"source" varchar(50) NOT NULL,
	"reason" varchar(100) DEFAULT '' NOT NULL,
	"reference_type" varchar(50) DEFAULT '' NOT NULL,
	"reference_id" varchar(36) DEFAULT '' NOT NULL,
	"idempotency_key" varchar(64) DEFAULT '' NOT NULL,
	"request_hash" varchar(64) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_cl_idempotency" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "game"."equip_slots" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"frame" varchar(50) DEFAULT 'medium_frame' NOT NULL,
	"weapon" varchar(50) DEFAULT 'machine_gun' NOT NULL,
	"core" varchar(50) DEFAULT 'assault_core' NOT NULL,
	"module" varchar(50) DEFAULT 'power_module' NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "equip_slots_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "game"."item_ledger" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"item_type" varchar(20) NOT NULL,
	"item_id" varchar(50) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"source" varchar(50) NOT NULL,
	"reference_type" varchar(50) DEFAULT '' NOT NULL,
	"reference_id" varchar(36) DEFAULT '' NOT NULL,
	"idempotency_key" varchar(64) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_il_idempotency" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "game"."mecha_configs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"name" varchar(50) DEFAULT '기본 구성' NOT NULL,
	"frame" varchar(50) DEFAULT 'medium_frame' NOT NULL,
	"weapon" varchar(50) DEFAULT 'machine_gun' NOT NULL,
	"core" varchar(50) DEFAULT 'assault_core' NOT NULL,
	"module" varchar(50) DEFAULT 'power_module' NOT NULL,
	"is_active" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."mecha_stats" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"attack_power" integer DEFAULT 10 NOT NULL,
	"attack_speed" integer DEFAULT 100 NOT NULL,
	"move_speed" integer DEFAULT 100 NOT NULL,
	"dash_cooldown" integer DEFAULT 5000 NOT NULL,
	"ultimate_power" integer DEFAULT 30 NOT NULL,
	"ultimate_cooldown" integer DEFAULT 30000 NOT NULL,
	"max_hp" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "mecha_stats_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "game"."operator_account_roles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"operator_account_id" varchar(36) NOT NULL,
	"role_id" varchar(36) NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_oar_account_role" UNIQUE("operator_account_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "game"."operator_accounts" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"role_id" varchar(36) DEFAULT '' NOT NULL,
	"granted_by" varchar(36) DEFAULT '' NOT NULL,
	"granted_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operator_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "game"."operator_audit_logs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"operator_id" varchar(36) NOT NULL,
	"action" varchar(50) NOT NULL,
	"target_type" varchar(20) DEFAULT '' NOT NULL,
	"target_id" varchar(36) DEFAULT '' NOT NULL,
	"reason_code" varchar(50) DEFAULT '' NOT NULL,
	"reason_text" varchar(200) DEFAULT '' NOT NULL,
	"before_summary" varchar(500) DEFAULT '{}' NOT NULL,
	"after_summary" varchar(500) DEFAULT '{}' NOT NULL,
	"result" varchar(20) DEFAULT 'success' NOT NULL,
	"detail" varchar(1000) DEFAULT '{}' NOT NULL,
	"request_id" varchar(36) DEFAULT '' NOT NULL,
	"ip_hash" varchar(64) DEFAULT '' NOT NULL,
	"user_agent_summary" varchar(100) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."operator_grants" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"target_user_id" varchar(36) NOT NULL,
	"operator_id" varchar(36) NOT NULL,
	"grant_type" varchar(50) NOT NULL,
	"resource_code" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"reason_code" varchar(50) DEFAULT '' NOT NULL,
	"reason_text" varchar(200) NOT NULL,
	"external_reference" varchar(200) DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"idempotency_key" varchar(64) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_og_idempotency" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "game"."operator_permissions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(200) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operator_permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "game"."operator_role_permissions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"role_id" varchar(36) NOT NULL,
	"permission_id" varchar(36) NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_orp_role_perm" UNIQUE("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "game"."operator_roles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"code" varchar(20) NOT NULL,
	"description" varchar(200) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operator_roles_name_unique" UNIQUE("name"),
	CONSTRAINT "operator_roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "game"."parts_inventory" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"part_code" varchar(50) NOT NULL,
	"part_type" varchar(10) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"equipped" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_pi_player_code" UNIQUE("player_id","part_code")
);
--> statement-breakpoint
CREATE TABLE "game"."player_blueprints" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"blueprint_code" varchar(50) NOT NULL,
	"acquired_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_pb_player_code" UNIQUE("player_id","blueprint_code")
);
--> statement-breakpoint
CREATE TABLE "game"."player_profiles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"nickname" varchar(20) NOT NULL,
	"highest_stage" integer DEFAULT 1 NOT NULL,
	"display_name" varchar(30),
	"avatar_url" varchar(512),
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "player_profiles_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "game"."player_records" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"stage_id" varchar(36) NOT NULL,
	"best_clear_time_sec" integer,
	"best_kill_count" integer DEFAULT 0 NOT NULL,
	"total_clears" integer DEFAULT 0 NOT NULL,
	"first_cleared_at" timestamp (3) with time zone,
	"last_cleared_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_pr_player_stage" UNIQUE("player_id","stage_id")
);
--> statement-breakpoint
CREATE TABLE "game"."player_research" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"code" varchar(50) NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_pr_player_code" UNIQUE("player_id","code")
);
--> statement-breakpoint
CREATE TABLE "game"."player_stage_progress" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"stage_id" varchar(36) NOT NULL,
	"unlocked_at" timestamp (3) with time zone,
	"first_cleared_at" timestamp (3) with time zone,
	"best_clear_time_ms" integer,
	"highest_boss_sequence" integer DEFAULT 0 NOT NULL,
	"clear_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "uq_psp_player_stage" UNIQUE("player_id","stage_id")
);
--> statement-breakpoint
CREATE TABLE "game"."players" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"nickname" varchar(20) NOT NULL,
	"api_key" varchar(36) NOT NULL,
	"electricity" integer DEFAULT 0 NOT NULL,
	"electricity_per_second" integer DEFAULT 1 NOT NULL,
	"last_claimed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."refresh_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."security_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"user_id" varchar(36),
	"player_id" varchar(36),
	"session_id" varchar(36),
	"code" varchar(50) DEFAULT '' NOT NULL,
	"severity" varchar(10) DEFAULT 'warn' NOT NULL,
	"source" varchar(50) DEFAULT '' NOT NULL,
	"reference_type" varchar(50) DEFAULT '' NOT NULL,
	"reference_id" varchar(36) DEFAULT '' NOT NULL,
	"detail" varchar(1000) DEFAULT '{}' NOT NULL,
	"safe_details" varchar(1000) DEFAULT '{}' NOT NULL,
	"request_id" varchar(36) DEFAULT '' NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"reviewed_at" timestamp (3) with time zone,
	"reviewed_by_operator_id" varchar(36),
	"resolution" varchar(50) DEFAULT '' NOT NULL,
	"resolution_note" varchar(200) DEFAULT '' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."stage_bosses" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"stage_id" varchar(36) NOT NULL,
	"boss_code" varchar(50) NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"checkpoint_seconds" integer NOT NULL,
	"reward_definition" varchar(500) DEFAULT '{}' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."stage_rewards" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"stage_id" varchar(36) NOT NULL,
	"clear_type" varchar(20) DEFAULT 'normal' NOT NULL,
	"scrap_min" integer DEFAULT 0 NOT NULL,
	"scrap_max" integer DEFAULT 0 NOT NULL,
	"blueprint_drop_rate" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."stages" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" varchar(200) DEFAULT '' NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"entry_requirement" varchar(100) DEFAULT 'none' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"recommended_power" integer DEFAULT 10 NOT NULL,
	"enemy_set" varchar(200) DEFAULT '[]' NOT NULL,
	"boss_timings" varchar(100) DEFAULT '[180,360]' NOT NULL,
	"max_kills" integer DEFAULT 300 NOT NULL,
	"max_core_energy" integer DEFAULT 300 NOT NULL,
	"core_per_level" integer DEFAULT 50 NOT NULL,
	"core_per_kill" integer DEFAULT 5 NOT NULL,
	"scrap_per_kill" integer DEFAULT 1 NOT NULL,
	"unlocked" integer DEFAULT 1 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"content_version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."users" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"nickname" varchar(20) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"suspended_at" timestamp (3) with time zone,
	"suspended_reason" varchar(200),
	"refresh_token" varchar(512),
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_nickname_unique" UNIQUE("nickname")
);
--> statement-breakpoint
CREATE TABLE "game"."wallet_balances" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"player_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"currency" varchar(20) DEFAULT 'electricity' NOT NULL,
	"electricity" integer DEFAULT 0 NOT NULL,
	"electricity_per_second" integer DEFAULT 1 NOT NULL,
	"scrap" integer DEFAULT 0 NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"last_claimed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "wallet_balances_player_id_unique" UNIQUE("player_id"),
	CONSTRAINT "uq_wb_user_currency" UNIQUE("user_id","currency"),
	CONSTRAINT "wallet_nonnegative" CHECK ("game"."wallet_balances"."electricity" >= 0 AND "game"."wallet_balances"."balance" >= 0 AND "game"."wallet_balances"."scrap" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_as_user_id" ON "game"."account_sanctions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ai_runs_status_created" ON "game"."ai_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_runs_operator_created" ON "game"."ai_runs" USING btree ("operator_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_tool_calls_run_created" ON "game"."ai_tool_calls" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_be_session_id" ON "game"."battle_events" USING btree ("battle_session_id");--> statement-breakpoint
CREATE INDEX "idx_br_session_id" ON "game"."battle_results" USING btree ("battle_session_id");--> statement-breakpoint
CREATE INDEX "idx_bs_player_id" ON "game"."battle_sessions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_bs_status" ON "game"."battle_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_buo_session_id" ON "game"."battle_upgrade_offers" USING btree ("battle_session_id");--> statement-breakpoint
CREATE INDEX "idx_cq_player_id" ON "game"."crafting_queue" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_cl_player_id" ON "game"."currency_ledger" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_cl_user_id" ON "game"."currency_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_cl_created_at" ON "game"."currency_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_il_player_id" ON "game"."item_ledger" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_il_user_id" ON "game"."item_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_mc_player_id" ON "game"."mecha_configs" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_ms_player_id" ON "game"."mecha_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_oar_account" ON "game"."operator_account_roles" USING btree ("operator_account_id");--> statement-breakpoint
CREATE INDEX "idx_oa_user_id" ON "game"."operator_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oal_operator" ON "game"."operator_audit_logs" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "idx_oal_action" ON "game"."operator_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_oal_created_at" ON "game"."operator_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_og_target_user" ON "game"."operator_grants" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "idx_og_operator" ON "game"."operator_grants" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "idx_op_code" ON "game"."operator_permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_orp_role" ON "game"."operator_role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_or_name" ON "game"."operator_roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_pi_player_id" ON "game"."parts_inventory" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_pb_player_id" ON "game"."player_blueprints" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_pp_user_id" ON "game"."player_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pr_player_stage" ON "game"."player_records" USING btree ("player_id","stage_id");--> statement-breakpoint
CREATE INDEX "idx_pr_player_id" ON "game"."player_research" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_psp_player_stage" ON "game"."player_stage_progress" USING btree ("player_id","stage_id");--> statement-breakpoint
CREATE INDEX "idx_players_api_key" ON "game"."players" USING btree ("api_key");--> statement-breakpoint
CREATE INDEX "idx_players_electricity" ON "game"."players" USING btree ("electricity");--> statement-breakpoint
CREATE INDEX "idx_rs_user_id" ON "game"."refresh_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_rs_expires_at" ON "game"."refresh_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_se_user_id" ON "game"."security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_se_event_type" ON "game"."security_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_se_created_at" ON "game"."security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_sb_stage_id" ON "game"."stage_bosses" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "idx_sr_stage_id" ON "game"."stage_rewards" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "idx_stages_unlocked" ON "game"."stages" USING btree ("unlocked");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "game"."users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wb_user_id" ON "game"."wallet_balances" USING btree ("user_id");

CREATE TABLE game.request_idempotency (
  scope_key text PRIMARY KEY, request_hash text NOT NULL, status integer NOT NULL,
  response_body text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX idx_request_idempotency_expiry ON game.request_idempotency(expires_at);
CREATE TABLE game.request_rate_limits (
  scope_key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL
);
DO $$
DECLARE table_name text; role_name text;
BEGIN
  REVOKE ALL ON SCHEMA game FROM PUBLIC;
  FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'game' LOOP
    EXECUTE format('ALTER TABLE game.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA game FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA game FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA game FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
