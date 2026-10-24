ALTER TABLE "approvals" ADD COLUMN "code_misses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "request" text DEFAULT '' NOT NULL;