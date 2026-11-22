CREATE TYPE "public"."asset_kind" AS ENUM('slice', 'mask');--> statement-breakpoint
CREATE TYPE "public"."asset_tier" AS ENUM('preview', 'full');--> statement-breakpoint
CREATE TYPE "public"."psd_upload_status" AS ENUM('pending', 'uploaded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."psd_version_status" ADD VALUE 'uploading' BEFORE 'uploaded';--> statement-breakpoint
CREATE TABLE "version_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"psd_version_id" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"tier" "asset_tier" NOT NULL,
	"key" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "psd_versions" ALTER COLUMN "psd_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "psd_versions" ALTER COLUMN "size_bytes" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "psd_versions" ALTER COLUMN "status" SET DEFAULT 'uploading';--> statement-breakpoint
ALTER TABLE "psd_versions" ADD COLUMN "psd_upload_status" "psd_upload_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "psd_versions" ADD COLUMN "slice_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "psd_versions" ADD COLUMN "total_preview_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "psd_versions" ADD COLUMN "total_full_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "psd_versions" ADD COLUMN "fidelity_score" text;--> statement-breakpoint
ALTER TABLE "version_assets" ADD CONSTRAINT "version_assets_psd_version_id_psd_versions_id_fk" FOREIGN KEY ("psd_version_id") REFERENCES "public"."psd_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "version_assets_version_id_idx" ON "version_assets" USING btree ("psd_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "version_assets_unique_idx" ON "version_assets" USING btree ("psd_version_id","sha256","tier","kind");