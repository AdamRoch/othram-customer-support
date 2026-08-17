CREATE TYPE "public"."stage" AS ENUM('RECEIVED', 'EXTRACTION', 'QUANTIFICATION', 'LIBRARY_PREP', 'SEQUENCING', 'BIOINFORMATICS', 'REVIEW', 'DELIVERED');--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_type" text NOT NULL,
	"current_stage" "stage" NOT NULL,
	"stage_entered_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"delayed" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text
);
--> statement-breakpoint
CREATE TABLE "stage_durations" (
	"stage" "stage" PRIMARY KEY NOT NULL,
	"standard_days" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;