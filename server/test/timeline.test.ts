import { describe, expect, it } from 'vitest';
import type { Stage } from '@othram/shared';
import { computeCaseTimeline } from '../src/cases/timeline.js';
import { stageDurationSeedData } from '../src/db/seed-data.js';

const receivedCase = {
  caseNumber: 'OTH-TEST-0001',
  currentStage: 'RECEIVED' as const,
  stageEnteredAt: new Date('2026-01-01T00:00:00.000Z'),
  delayed: false
};

describe('computed case timeline', () => {
  it('computes sequencing and delivery milestones from the current stage boundary', () => {
    const timeline = computeCaseTimeline(receivedCase, stageDurationSeedData, receivedCase.stageEnteredAt);

    expect(timeline).toMatchObject({
      currentStage: 'RECEIVED',
      timeInStageDays: 0,
      standardStageDurationDays: 1,
      pastStandardDuration: false,
      timelineStatus: 'ON_SCHEDULE',
      eta: {
        status: 'AVAILABLE',
        sequencing: {
          at: '2026-01-15T00:00:00.000Z',
          daysFromNow: 14,
          weeksFromNow: 2
        },
        delivery: {
          at: '2026-01-22T00:00:00.000Z',
          daysFromNow: 21,
          weeksFromNow: 3
        },
        standardTotalDays: 21,
        standardTotalWeeks: 3
      }
    });
  });

  it.each([
    ['RECEIVED', 21, '2026-01-15T00:00:00.000Z'],
    ['EXTRACTION', 20, '2026-01-14T00:00:00.000Z'],
    ['QUANTIFICATION', 15, '2026-01-09T00:00:00.000Z'],
    ['LIBRARY_PREP', 13, '2026-01-07T00:00:00.000Z'],
    ['SEQUENCING', 7, '2026-01-01T00:00:00.000Z'],
    ['BIOINFORMATICS', 4, null],
    ['REVIEW', 2, null]
  ] satisfies ReadonlyArray<readonly [Stage, number, string | null]>) (
    'uses the %s stage boundary as the start of the remaining timeline',
    (currentStage, remainingDays, sequencingAt) => {
      const stageEnteredAt = new Date('2026-01-01T00:00:00.000Z');
      const timeline = computeCaseTimeline(
        {
          caseNumber: 'OTH-TEST-BOUNDARY',
          currentStage,
          stageEnteredAt,
          delayed: false
        },
        stageDurationSeedData,
        stageEnteredAt
      );

      expect(timeline.eta.status).toBe('AVAILABLE');
      if (timeline.eta.status !== 'AVAILABLE') {
        throw new Error('Expected an available ETA');
      }
      expect(timeline.eta.delivery.at).toBe(
        new Date(stageEnteredAt.getTime() + remainingDays * 24 * 60 * 60 * 1000).toISOString()
      );
      expect(timeline.eta.sequencing?.at ?? null).toBe(sequencingAt);
    }
  );

  it('does not mark a stage overdue at its exact standard boundary', () => {
    const atBoundary = computeCaseTimeline(
      receivedCase,
      stageDurationSeedData,
      new Date('2026-01-02T00:00:00.000Z')
    );
    const afterBoundary = computeCaseTimeline(
      receivedCase,
      stageDurationSeedData,
      new Date('2026-01-02T00:00:00.001Z')
    );

    expect(atBoundary).toMatchObject({
      timeInStageDays: 1,
      pastStandardDuration: false,
      timelineStatus: 'ON_SCHEDULE'
    });
    expect(afterBoundary).toMatchObject({
      timeInStageDays: 1,
      pastStandardDuration: true,
      timelineStatus: 'PAST_STANDARD_DURATION'
    });
  });

  it('withholds a revised ETA when the persisted Case is delayed', () => {
    const timeline = computeCaseTimeline(
      {
        caseNumber: 'OTH-TEST-0002',
        currentStage: 'SEQUENCING',
        stageEnteredAt: new Date('2026-01-01T00:00:00.000Z'),
        delayed: true
      },
      stageDurationSeedData,
      new Date('2026-01-22T00:00:00.000Z')
    );

    expect(timeline).toMatchObject({
      delayed: true,
      timelineStatus: 'DELAYED',
      pastStandardDuration: true,
      eta: {
        status: 'UNAVAILABLE',
        reason: 'CASE_DELAYED'
      }
    });
  });

  it('reports a delivered Case as complete instead of estimating another date', () => {
    const deliveredAt = new Date('2026-01-01T00:00:00.000Z');
    const timeline = computeCaseTimeline(
      {
        caseNumber: 'OTH-TEST-0003',
        currentStage: 'DELIVERED',
        stageEnteredAt: deliveredAt,
        delayed: false
      },
      stageDurationSeedData,
      new Date('2026-01-03T00:00:00.000Z')
    );

    expect(timeline).toMatchObject({
      currentStage: 'DELIVERED',
      timelineStatus: 'DELIVERED',
      eta: {
        status: 'COMPLETE',
        deliveredAt: deliveredAt.toISOString()
      }
    });
  });

  it('fails closed when a standard stage duration is missing', () => {
    expect(() => computeCaseTimeline(receivedCase, stageDurationSeedData.slice(1), receivedCase.stageEnteredAt)).toThrow(
      'Missing or invalid standard duration for RECEIVED'
    );
  });
});
