import { eq, sql } from 'drizzle-orm';
import type { Stage } from '@othram/shared';
import type { createDatabase } from '../db/client.js';
import { cases, customers, stageDurations } from '../db/schema.js';
import type { StageDuration, TimelineCase } from './timeline.js';

export interface CaseTimelineInput {
  caseRecord: TimelineCase;
  stageDurations: ReadonlyArray<StageDuration>;
}

export interface CaseTimelineRepository {
  findTimelineInput(caseNumber: string): Promise<CaseTimelineInput | null>;
}

export interface CaseLookupRepository {
  findTimelineInputsByCustomerEmail(customerEmail: string): Promise<ReadonlyArray<CaseTimelineInput>>;
}

type Database = ReturnType<typeof createDatabase>['db'];

function toTimelineInput(
  caseRecord: {
    caseNumber: string;
    currentStage: string;
    stageEnteredAt: Date;
    delayed: boolean;
  },
  persistedDurations: ReadonlyArray<{ stage: string; standardDays: number }>
): CaseTimelineInput {
  return {
    caseRecord: {
      ...caseRecord,
      currentStage: caseRecord.currentStage as Stage
    },
    stageDurations: persistedDurations.map((duration) => ({
      ...duration,
      stage: duration.stage as Stage
    }))
  };
}

export function createCaseTimelineRepository(
  database: Database
): CaseTimelineRepository & CaseLookupRepository {
  return {
    async findTimelineInput(caseNumber) {
      return database.transaction(async (tx) => {
        const [caseRecord] = await tx
          .select({
            caseNumber: cases.caseNumber,
            currentStage: cases.currentStage,
            stageEnteredAt: cases.stageEnteredAt,
            delayed: cases.delayed
          })
          .from(cases)
          .where(eq(cases.caseNumber, caseNumber));

        if (!caseRecord) {
          return null;
        }

        const persistedDurations = await tx.select({
          stage: stageDurations.stage,
          standardDays: stageDurations.standardDays
        }).from(stageDurations);

        return toTimelineInput(caseRecord, persistedDurations);
      });
    },

    async findTimelineInputsByCustomerEmail(customerEmail) {
      return database.transaction(async (tx) => {
        const caseRecords = await tx
          .select({
            caseNumber: cases.caseNumber,
            currentStage: cases.currentStage,
            stageEnteredAt: cases.stageEnteredAt,
            delayed: cases.delayed
          })
          .from(cases)
          .innerJoin(customers, eq(cases.customerId, customers.id))
          .where(eq(sql`lower(${customers.email})`, customerEmail.trim().toLowerCase()))
          .orderBy(cases.caseNumber);

        const persistedDurations = await tx.select({
          stage: stageDurations.stage,
          standardDays: stageDurations.standardDays
        }).from(stageDurations);

        return caseRecords.map((caseRecord) => toTimelineInput(caseRecord, persistedDurations));
      });
    }
  };
}
