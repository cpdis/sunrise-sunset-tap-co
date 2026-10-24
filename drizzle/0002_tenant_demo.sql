ALTER TABLE "tenants" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- seedDemo is the only code that makes the "sunrise-sunset" business, so a database that already holds it holds the demo.
UPDATE "tenants" SET "demo" = true WHERE "id" = 'sunrise-sunset';
