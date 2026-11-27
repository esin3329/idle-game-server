ALTER TABLE game.crafting_queue
  ADD COLUMN idempotency_key varchar(64);
--> statement-breakpoint

CREATE UNIQUE INDEX uq_cq_idempotency
  ON game.crafting_queue (idempotency_key);
