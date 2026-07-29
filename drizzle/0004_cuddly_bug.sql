CREATE TABLE "google_health_dpop_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"private_jwk_ciphertext" text NOT NULL,
	"private_jwk_iv" text NOT NULL,
	"private_jwk_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"thumbprint" text NOT NULL,
	"nonce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_health_dpop_key_connection_id_unique" UNIQUE("connection_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_access_token_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"scopes" text[] NOT NULL,
	CONSTRAINT "mcp_oauth_access_token_v2_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_client_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"user_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"token_endpoint_auth_method" text,
	"grant_types" text[],
	"response_types" text[],
	"public" boolean,
	"type" text,
	"require_pkce" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "mcp_oauth_client_v2_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_consent_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"scopes" text[] NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_rate_limit_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "mcp_oauth_rate_limit_v2_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_refresh_token_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"revoked" timestamp,
	"auth_time" timestamp,
	"scopes" text[] NOT NULL,
	CONSTRAINT "mcp_oauth_refresh_token_v2_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "google_health_dpop_key" ADD CONSTRAINT "google_health_dpop_key_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_token_v2" ADD CONSTRAINT "mcp_oauth_access_token_v2_client_id_mcp_oauth_client_v2_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_client_v2"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_token_v2" ADD CONSTRAINT "mcp_oauth_access_token_v2_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_token_v2" ADD CONSTRAINT "mcp_oauth_access_token_v2_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_token_v2" ADD CONSTRAINT "mcp_oauth_access_token_v2_refresh_id_mcp_oauth_refresh_token_v2_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."mcp_oauth_refresh_token_v2"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_client_v2" ADD CONSTRAINT "mcp_oauth_client_v2_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_consent_v2" ADD CONSTRAINT "mcp_oauth_consent_v2_client_id_mcp_oauth_client_v2_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_client_v2"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_consent_v2" ADD CONSTRAINT "mcp_oauth_consent_v2_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_token_v2" ADD CONSTRAINT "mcp_oauth_refresh_token_v2_client_id_mcp_oauth_client_v2_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_client_v2"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_token_v2" ADD CONSTRAINT "mcp_oauth_refresh_token_v2_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_token_v2" ADD CONSTRAINT "mcp_oauth_refresh_token_v2_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_token_v2_client_id_idx" ON "mcp_oauth_access_token_v2" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_token_v2_session_id_idx" ON "mcp_oauth_access_token_v2" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_token_v2_user_id_idx" ON "mcp_oauth_access_token_v2" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_token_v2_refresh_id_idx" ON "mcp_oauth_access_token_v2" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_client_v2_user_id_idx" ON "mcp_oauth_client_v2" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_consent_v2_client_id_idx" ON "mcp_oauth_consent_v2" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_consent_v2_user_id_idx" ON "mcp_oauth_consent_v2" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_rate_limit_v2_key_idx" ON "mcp_oauth_rate_limit_v2" USING btree ("key");--> statement-breakpoint
CREATE INDEX "mcp_oauth_refresh_token_v2_client_id_idx" ON "mcp_oauth_refresh_token_v2" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_refresh_token_v2_session_id_idx" ON "mcp_oauth_refresh_token_v2" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_refresh_token_v2_user_id_idx" ON "mcp_oauth_refresh_token_v2" USING btree ("user_id");