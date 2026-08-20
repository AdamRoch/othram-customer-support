CREATE TABLE "local_ticket_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"ingest_sequence" bigserial NOT NULL,
	"author" text NOT NULL,
	"is_public" boolean NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_ticket_comments_ingest_sequence_unique" UNIQUE("ingest_sequence")
);
--> statement-breakpoint
CREATE TABLE "local_ticket_idempotency" (
	"ticket_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_ticket_requesters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_ticket_requesters_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "local_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"team" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "local_ticket_comments" ADD CONSTRAINT "local_ticket_comments_ticket_id_local_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."local_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_ticket_idempotency" ADD CONSTRAINT "local_ticket_idempotency_ticket_id_local_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."local_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_tickets" ADD CONSTRAINT "local_tickets_requester_id_local_ticket_requesters_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."local_ticket_requesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_ticket_idempotency_ticket_key" ON "local_ticket_idempotency" USING btree ("ticket_id","key");