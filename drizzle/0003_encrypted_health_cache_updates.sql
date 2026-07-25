CREATE TABLE "health_update_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_hash" text NOT NULL,
	"data_type" text NOT NULL,
	"operation" text NOT NULL,
	"intervals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_update_inbox_user_id_event_hash_unique" UNIQUE("user_id","event_hash")
);
--> statement-breakpoint
DELETE FROM "health_cache";--> statement-breakpoint
ALTER TABLE "health_cache" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "health_cache" ADD COLUMN "operation" text DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE "health_cache" ADD COLUMN "payload_ciphertext" text;--> statement-breakpoint
ALTER TABLE "health_cache" ADD COLUMN "payload_iv" text;--> statement-breakpoint
ALTER TABLE "health_cache" ADD COLUMN "payload_tag" text;--> statement-breakpoint
ALTER TABLE "health_cache" ADD COLUMN "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "health_cache" ADD COLUMN "source_fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "health_update_inbox" ADD CONSTRAINT "health_update_inbox_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_update_inbox_user_status_idx" ON "health_update_inbox" USING btree ("user_id","status");
