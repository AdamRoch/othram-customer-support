import { eq } from 'drizzle-orm';
import type { Stage } from '@othram/shared';
import type { createDatabase } from '../db/client.js';
import { cases, stageDurations } from '../db/schema.js';
import type { StageDuration, TimelineCase } from './timeline.js';

export interface CaseTimelineInput {
  caseRecord: TimelineCase;
  stageDurations: ReadonlyArray<StageDuration>;
}

export interface CaseTimelineRepository {
  findTimelineInput(caseNumber: string): Promise<CaseTimelineInput | null>;
}

type Database = ReturnType<typeof createDatabase>['db'];

export function createCaseTimelineRepository(database: Database): CaseTimelineRepository {
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

        const persistedDurations = await tx
          .select({ stage: stageDurations.stage, standardDays: stageDurations.standardDays })
          .from(stageDurations);

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
      });
    }
  };
}
