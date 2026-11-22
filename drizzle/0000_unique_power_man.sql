CREATE TYPE "public"."analytics_event_type" AS ENUM('visit', 'form_started', 'generated', 'downloaded', 'shared');--> statement-breakpoint
CREATE TYPE "public"."event_format" AS ENUM('square', 'story', 'portrait', 'original');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."placeholder_type" AS ENUM('text', 'image');--> statement-breakpoint
CREATE TYPE "public"."psd_version_status" AS ENUM('uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."validation_severity" AS ENUM('error', 'warning', 'passed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"type" "analytics_event_type" NOT NULL,
	"format" text,
	"source" text,
	"visitor_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_formats" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"format" "event_format" DEFAULT 'square' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"published_version_id" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"prefix" text DEFAULT '#PLACEHOLDER_' NOT NULL,
	"hashtag" text,
	"share_caption" text,
	"venue_name" text,
	"address" text,
	"map_url" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"schedule" jsonb,
	"dress_code" text,
	"contact" text,
	"closes_at" timestamp with time zone,
	"max_flyers" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "fonts" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"family" text NOT NULL,
	"weight" integer,
	"style" text,
	"file_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "generation_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placeholders" (
	"id" text PRIMARY KEY NOT NULL,
	"psd_version_id" text NOT NULL,
	"layer_id" text NOT NULL,
	"layer_name" text NOT NULL,
	"key" text NOT NULL,
	"type" "placeholder_type" DEFAULT 'text' NOT NULL,
	"sample_value" text,
	"box" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"text_style" jsonb,
	"mask_key" text
);
--> statement-breakpoint
CREATE TABLE "psd_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"event_format_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"psd_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"status" "psd_version_status" DEFAULT 'uploaded' NOT NULL,
	"error_message" text,
	"manifest_key" text,
	"preview_key" text,
	"clean_preview_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "validation_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"psd_version_id" text NOT NULL,
	"severity" "validation_severity" NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"layer_name" text,
	"placeholder_id" text
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_formats" ADD CONSTRAINT "event_formats_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonts" ADD CONSTRAINT "fonts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tokens" ADD CONSTRAINT "generation_tokens_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placeholders" ADD CONSTRAINT "placeholders_psd_version_id_psd_versions_id_fk" FOREIGN KEY ("psd_version_id") REFERENCES "public"."psd_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psd_versions" ADD CONSTRAINT "psd_versions_event_format_id_event_formats_id_fk" FOREIGN KEY ("event_format_id") REFERENCES "public"."event_formats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_issues" ADD CONSTRAINT "validation_issues_psd_version_id_psd_versions_id_fk" FOREIGN KEY ("psd_version_id") REFERENCES "public"."psd_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_event_id_created_idx" ON "analytics_events" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_event_id_type_idx" ON "analytics_events" USING btree ("event_id","type");--> statement-breakpoint
CREATE INDEX "event_formats_event_id_idx" ON "event_formats" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_owner_id_idx" ON "events" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_idx" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "events_active_idx" ON "events" USING btree ("deleted_at") WHERE "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "fonts_event_id_idx" ON "fonts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "generation_tokens_event_id_idx" ON "generation_tokens" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "placeholders_version_id_idx" ON "placeholders" USING btree ("psd_version_id");--> statement-breakpoint
CREATE INDEX "psd_versions_format_id_idx" ON "psd_versions" USING btree ("event_format_id");--> statement-breakpoint
CREATE INDEX "validation_issues_version_id_idx" ON "validation_issues" USING btree ("psd_version_id");