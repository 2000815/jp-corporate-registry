CREATE TABLE IF NOT EXISTS "corporation" (
	"id" integer NOT NULL,
	"corporate_number" char(13) NOT NULL,
	"process_type" char(2) NOT NULL,
	"correction_type" char(1) DEFAULT '0' NOT NULL,
	"updated_date" date NOT NULL,
	"changed_date" date,
	"name" varchar(300),
	"name_image_id" varchar(8),
	"corporation_type" varchar(3),
	"prefecture_name" varchar(50),
	"city_name" varchar(100),
	"street_number" varchar(300),
	"address_image_id" varchar(8),
	"prefecture_code" char(2),
	"city_code" char(5),
	"postal_code" char(7),
	"foreign_address" varchar(300),
	"foreign_address_image_id" varchar(8),
	"close_date" date,
	"close_cause" char(2),
	"successor_corporate_number" char(13),
	"successor_cause" varchar(200),
	"successor_date" date,
	"dummy_flag" boolean DEFAULT false NOT NULL,
	"name_en" varchar(300),
	"prefecture_name_en" varchar(100),
	"street_number_en" varchar(300),
	"address_en_image_id" varchar(8),
	"furigana" varchar(500),
	"exclude_from_search" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_pkey" PRIMARY KEY("corporate_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"processed_count" integer DEFAULT 0,
	"inserted_count" integer DEFAULT 0,
	"updated_count" integer DEFAULT 0,
	"success" boolean DEFAULT false NOT NULL,
	"error_message" varchar(1000),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"last_processed_date" date NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corporation_name_idx" ON "corporation" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corporation_name_trgm_idx" ON "corporation" USING gin ("name" gin_trgm_ops) WHERE "corporation"."exclude_from_search" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corporation_name_lower_idx" ON "corporation" USING btree (lower("name")) WHERE "corporation"."exclude_from_search" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corporation_search_order_idx" ON "corporation" USING btree (lower("name"),"corporate_number") WHERE "corporation"."exclude_from_search" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corporation_corporate_number_idx" ON "corporation" USING btree ("corporate_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corporation_updated_date_idx" ON "corporation" USING btree ("updated_date");