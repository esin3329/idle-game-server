ALTER TABLE game.battle_upgrade_offers
  DROP CONSTRAINT uq_buo_session_level;
--> statement-breakpoint

ALTER TABLE game.battle_upgrade_offers
  ADD CONSTRAINT uq_buo_session_option_slot UNIQUE (battle_session_id, level, option_slot),
  ADD CONSTRAINT uq_buo_session_upgrade UNIQUE (battle_session_id, level, upgrade_id);
