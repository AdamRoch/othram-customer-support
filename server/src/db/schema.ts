import {
  bigserial,
  boolean,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { stages } from '@othram/shared';

export const stageEnum = pgEnum('stage', stages);

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone')
});

export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseNumber: text('case_number').notNull().unique(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  serviceType: text('service_type').notNull(),
  currentStage: stageEnum('current_stage').notNull(),
  stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  delayed: boolean('delayed').notNull().default(false),
  notes: text('notes')
});

export const stageDurations = pgTable('stage_durations', {
  stage: stageEnum('stage').primaryKey(),
  standardDays: integer('standard_days').notNull()
});

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: text('id').primaryKey(),
  sourcePath: text('source_path').notNull(),
  documentTitle: text('document_title').notNull(),
  documentSection: text('document_section').notNull(),
  sectionTitle: text('section_title').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull()
});

export const localTicketRequesters = pgTable('local_ticket_requesters', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const localTickets = pgTable('local_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterId: uuid('requester_id')
    .notNull()
    .references(() => localTicketRequesters.id),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('open'),
  team: text('team'),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const localTicketComments = pgTable('local_ticket_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => localTickets.id),
  ingestSequence: bigserial('ingest_sequence', { mode: 'bigint' }).notNull().unique(),
  author: text('author').notNull(),
  isPublic: boolean('is_public').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('local_ticket_requester_public_ingest_cursor')
    .on(table.ingestSequence)
    .where(sql`${table.author} = 'requester' AND ${table.isPublic} = true`)
]);

export const localTicketIdempotency = pgTable(
  'local_ticket_idempotency',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => localTickets.id),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('local_ticket_idempotency_ticket_key').on(table.ticketId, table.key)]
);

/** A named durable checkpoint for an inbound TicketGateway stream. */
export const ticketIngestionCursors = pgTable('ticket_ingestion_cursors', {
  name: text('name').primaryKey(),
  cursor: text('cursor'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * The worker owns this state, while TicketGateway remains the authority for
 * ticket content.  Text is stored before a gateway write so retrying a crash
 * window uses the same idempotency key and never asks the model twice.
 */
export const ticketWorkItems = pgTable(
  'ticket_work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Gateway identifiers are opaque: this worker is not coupled to one provider's schema.
    ticketId: text('ticket_id').notNull(),
    inboundCommentId: text('inbound_comment_id').notNull(),
    inboundCursor: text('inbound_cursor').notNull(),
    queueOrder: bigserial('queue_order', { mode: 'bigint' }).notNull().unique(),
    status: text('status').notNull().default('PENDING'),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    replyText: text('reply_text'),
    replyIdempotencyKey: text('reply_idempotency_key').notNull(),
    escalation: jsonb('escalation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('ticket_work_items_ticket_comment').on(table.ticketId, table.inboundCommentId),
    index('ticket_work_items_dispatch').on(table.status, table.ticketId, table.queueOrder)
  ]
);
