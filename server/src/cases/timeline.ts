import { stages } from '@othram/shared';
import type { CaseTimelineResponse, Stage, TimelineMilestone, TimelineStatus } from '@othram/shared';

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export interface TimelineCase {
  caseNumber: string;
  currentStage: Stage;
  stageEnteredAt: Date;
  delayed: boolean;
}

export interface StageDuration {
  stage: Stage;
  standardDays: number;
}

function milestone(target: Date, now: Date): TimelineMilestone {
  const daysFromNow = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / millisecondsPerDay));

  return {
    at: target.toISOString(),
    daysFromNow,
    weeksFromNow: Math.ceil(daysFromNow / 7)
  };
}

function durationMap(stageDurations: ReadonlyArray<StageDuration>): Map<Stage, number> {
  const durations = new Map(stageDurations.map(({ stage, standardDays }) => [stage, standardDays]));

  for (const stage of stages) {
    const duration = durations.get(stage);
    if (duration === undefined || !Number.isInteger(duration) || duration < 0) {
      throw new Error(`Missing or invalid standard duration for ${stage}`);
    }
  }

  return durations;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * millisecondsPerDay);
}

export function computeCaseTimeline(
  caseRecord: TimelineCase,
  stageDurations: ReadonlyArray<StageDuration>,
  now = new Date()
): CaseTimelineResponse {
  const elapsedMilliseconds = now.getTime() - caseRecord.stageEnteredAt.getTime();
  if (elapsedMilliseconds < 0) {
    throw new Error(`Stage entry for ${caseRecord.caseNumber} is in the future`);
  }

  const durations = durationMap(stageDurations);
  const currentStageIndex = stages.indexOf(caseRecord.currentStage);
  const sequencingStageIndex = stages.indexOf('SEQUENCING');
  const standardStageDurationDays = durations.get(caseRecord.currentStage)!;
  const timeInStageDays = Math.floor(elapsedMilliseconds / millisecondsPerDay);
  const pastStandardDuration = elapsedMilliseconds > standardStageDurationDays * millisecondsPerDay;
  const standardTotalDays = stages.reduce((total, stage) => total + durations.get(stage)!, 0);
  const standardTotalWeeks = Math.ceil(standardTotalDays / 7);

  let timelineStatus: TimelineStatus = pastStandardDuration ? 'PAST_STANDARD_DURATION' : 'ON_SCHEDULE';
  if (caseRecord.delayed) {
    timelineStatus = 'DELAYED';
  }
  if (caseRecord.currentStage === 'DELIVERED') {
    timelineStatus = 'DELIVERED';
  }

  const commonFacts = {
    caseNumber: caseRecord.caseNumber,
    currentStage: caseRecord.currentStage,
    stageEnteredAt: caseRecord.stageEnteredAt.toISOString(),
    timeInStageDays,
    standardStageDurationDays,
    pastStandardDuration,
    delayed: caseRecord.delayed,
    timelineStatus
  };

  if (caseRecord.currentStage === 'DELIVERED') {
    return {
      ...commonFacts,
      eta: {
        status: 'COMPLETE',
        deliveredAt: caseRecord.stageEnteredAt.toISOString(),
        standardTotalDays,
        standardTotalWeeks
      }
    };
  }

  if (caseRecord.delayed) {
    return {
      ...commonFacts,
      eta: {
        status: 'UNAVAILABLE',
        reason: 'CASE_DELAYED',
        standardTotalDays,
        standardTotalWeeks
      }
    };
  }

  const deliveryDaysFromStageEntry = stages
    .slice(currentStageIndex)
    .reduce((total, stage) => total + durations.get(stage)!, 0);
  const deliveryAt = addDays(caseRecord.stageEnteredAt, deliveryDaysFromStageEntry);

  let sequencing: TimelineMilestone | null = null;
  if (currentStageIndex <= sequencingStageIndex) {
    const sequencingDaysFromStageEntry = stages
      .slice(currentStageIndex, sequencingStageIndex)
      .reduce((total, stage) => total + durations.get(stage)!, 0);
    sequencing = milestone(addDays(caseRecord.stageEnteredAt, sequencingDaysFromStageEntry), now);
  }

  return {
    ...commonFacts,
    eta: {
      status: 'AVAILABLE',
      sequencing,
      delivery: milestone(deliveryAt, now),
      standardTotalDays,
      standardTotalWeeks
    }
  };
}
