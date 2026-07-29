ALTER TABLE "google_health_dpop_key" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "dpop_thumbprint" text;