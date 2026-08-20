CREATE TABLE "ticket_ingestion_cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" text NOT NULL,
	"inbound_comment_id" text NOT NULL,
	"inbound_cursor" text NOT NULL,
	"queue_order" bigserial NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reply_text" text,
	"reply_idempotency_key" text NOT NULL,
	"escalation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_work_items_queue_order_unique" UNIQUE("queue_order")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_work_items_ticket_comment" ON "ticket_work_items" USING btree ("ticket_id","inbound_comment_id");--> statement-breakpoint
CREATE INDEX "ticket_work_items_dispatch" ON "ticket_work_items" USING btree ("status","ticket_id","queue_order");--> statement-breakpoint
CREATE INDEX "local_ticket_requester_public_ingest_cursor" ON "local_ticket_comments" USING btree ("ingest_sequence") WHERE "local_ticket_comments"."author" = 'requester' AND "local_ticket_comments"."is_public" = true;