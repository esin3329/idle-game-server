ALTER TABLE `crafting_queue`
  ADD COLUMN `idempotency_key` varchar(64) NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX `uq_cq_idempotency`
  ON `crafting_queue` (`idempotency_key`);
