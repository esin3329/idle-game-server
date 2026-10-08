ALTER TABLE `battle_upgrade_offers`
  DROP INDEX `uq_buo_session_level`;
--> statement-breakpoint

ALTER TABLE `battle_upgrade_offers`
  ADD UNIQUE KEY `uq_buo_session_option_slot` (`battle_session_id`, `level`, `option_slot`),
  ADD UNIQUE KEY `uq_buo_session_upgrade` (`battle_session_id`, `level`, `upgrade_id`);
