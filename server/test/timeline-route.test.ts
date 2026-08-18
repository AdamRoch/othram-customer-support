import { afterAll, describe, expect, it } from 'vitest';
import type { CaseTimelineRepository } from '../src/cases/repository.js';
import { buildApp } from '../src/app.js';
import { createSeedData, stageDurationSeedData } from '../src/db/seed-data.js';

const reference = new Date('2026-08-17T12:00:00.000Z');
const seedData = createSeedData(reference);
const repository: CaseTimelineRepository = {
  async findTimelineInput(caseNumber) {
    const seedCase = seedData.cases.find((candidate) => candidate.caseNumber === caseNumber);
    if (!seedCase) {
      return null;
    }

    return {
      caseRecord: {
        caseNumber: seedCase.caseNumber,
        currentStage: seedCase.currentStage,
        stageEnteredAt: seedCase.stageEnteredAt,
        delayed: seedCase.delayed
      },
      stageDurations: stageDurationSeedData
    };
  }
};
const app = await buildApp({ timelineRepository: repository, now: () => reference, logger: false });

afterAll(async () => {
  await app.close();
});

describe('GET /api/cases/:caseNumber/timeline', () => {
  it('returns phrase-ready computed facts for the sent-last-Thursday Case', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cases/OTH-2026-0142/timeline' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      caseNumber: 'OTH-2026-0142',
      currentStage: 'EXTRACTION',
      stageEnteredAt: '2026-08-14T12:00:00.000Z',
      timeInStageDays: 3,
      delayed: false,
      timelineStatus: 'ON_SCHEDULE',
      eta: {
        status: 'AVAILABLE',
        sequencing: {
          at: '2026-08-27T12:00:00.000Z',
          daysFromNow: 10,
          weeksFromNow: 2
        },
        delivery: {
          at: '2026-09-03T12:00:00.000Z',
          daysFromNow: 17,
          weeksFromNow: 3
        },
        standardTotalDays: 21,
        standardTotalWeeks: 3
      }
    });
  });

  it('surfaces a delayed Case without inventing a replacement ETA', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cases/OTH-2026-0146/timeline' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      caseNumber: 'OTH-2026-0146',
      currentStage: 'SEQUENCING',
      delayed: true,
      timelineStatus: 'DELAYED',
      eta: {
        status: 'UNAVAILABLE',
        reason: 'CASE_DELAYED'
      }
    });
  });

  it('returns an explicit not-found result for an unknown Case number', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cases/OTH-UNKNOWN/timeline' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'CASE_NOT_FOUND',
      caseNumber: 'OTH-UNKNOWN'
    });
  });
});
