ALTER TABLE "approvals" ADD COLUMN "binding" text NOT NULL;--> statement-breakpoint
CREATE INDEX "approvals_owner_idx" ON "approvals" USING btree ("tenant_id","owner_id","status");--> statement-breakpoint
ALTER TABLE "approvals" DROP COLUMN "code_attempts";