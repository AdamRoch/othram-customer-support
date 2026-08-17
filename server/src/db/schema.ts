import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';
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
