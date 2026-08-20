import type { CaseTimelineResponse } from '@othram/shared';
import type { CaseLookupRepository, CaseTimelineInput, CaseTimelineRepository } from '../../cases/repository.js';
import { computeCaseTimeline } from '../../cases/timeline.js';

export type CaseLookupChannel = 'ticket' | 'voice';
export type CaseLookupScope = 'status' | 'beyond_status';

export interface LookupCaseInput {
  channel: CaseLookupChannel;
  scope: CaseLookupScope;
  caseNumber?: string;
  customerEmail?: string;
}

export type LookupCaseResult =
  | {
      status: 'FOUND';
      timeline: CaseTimelineResponse;
      customerMessage: string;
    }
  | {
      status: 'NOT_FOUND';
      caseNumber: string | null;
      customerMessage: string;
    }
  | {
      status: 'NEEDS_CASE_NUMBER';
      customerMessage: string;
    }
  | {
      status: 'NEEDS_DISAMBIGUATION';
      caseNumbers: ReadonlyArray<string>;
      customerMessage: string;
    }
  | {
      status: 'IDENTITY_REQUIRED';
      customerMessage: string;
    };

export interface LookupCaseToolDependencies {
  repository: CaseTimelineRepository & CaseLookupRepository;
  now?: () => Date;
}

export interface LookupCaseTool {
  lookupCase(input: LookupCaseInput): Promise<LookupCaseResult>;
}

function normalizeCaseNumber(caseNumber: string | undefined): string | undefined {
  const normalized = caseNumber?.trim().toUpperCase();
  return normalized || undefined;
}

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function stageName(stage: CaseTimelineResponse['currentStage']): string {
  return stage.toLowerCase().replaceAll('_', ' ');
}

export function formatTimelineForCustomer(timeline: CaseTimelineResponse): string {
  const opening = `Case ${timeline.caseNumber} is currently in ${stageName(timeline.currentStage)} and has been in this stage for ${pluralize(timeline.timeInStageDays, 'day')}.`;

  if (timeline.eta.status === 'COMPLETE') {
    return `${opening} The case was delivered on ${timeline.eta.deliveredAt}.`;
  }

  if (timeline.eta.status === 'UNAVAILABLE') {
    return `${opening} The case has a recorded delay, so I do not have a revised timeline to share.`;
  }

  const timing = [
    timeline.eta.sequencing
      ? `sequencing is expected in about ${pluralize(timeline.eta.sequencing.weeksFromNow, 'week')}`
      : null,
    `delivery is expected in about ${pluralize(timeline.eta.delivery.weeksFromNow, 'week')}`
  ]
    .filter((part): part is string => part !== null)
    .join(' and ');
  const schedule = timeline.timelineStatus === 'PAST_STANDARD_DURATION'
    ? 'The case has exceeded the standard duration for this stage.'
    : 'The case is currently on schedule.';

  return `${opening} ${schedule} Based on the standard processing timeline, ${timing}.`;
}

function notFound(caseNumber: string | undefined): LookupCaseResult {
  return {
    status: 'NOT_FOUND',
    caseNumber: caseNumber ?? null,
    customerMessage:
      "I can't locate that case. I don't want to guess about its status, but I can connect you with a specialist who can help."
  };
}

function timelineFor(
  input: CaseTimelineInput,
  now: Date
): Extract<LookupCaseResult, { status: 'FOUND' }> {
  const timeline = computeCaseTimeline(input.caseRecord, input.stageDurations, now);
  return { status: 'FOUND', timeline, customerMessage: formatTimelineForCustomer(timeline) };
}

export function createLookupCaseTool(dependencies: LookupCaseToolDependencies): LookupCaseTool {
  const now = dependencies.now ?? (() => new Date());

  return {
    async lookupCase(input) {
      const caseNumber = normalizeCaseNumber(input.caseNumber);

      if (input.channel === 'voice' && input.scope === 'beyond_status' && !input.customerEmail?.trim()) {
        return {
          status: 'IDENTITY_REQUIRED',
          customerMessage:
            'I can provide a case status with the case number, but anything beyond status requires the email address on file.'
        };
      }

      if (input.channel === 'voice') {
        if (!caseNumber) {
          return {
            status: 'NEEDS_CASE_NUMBER',
            customerMessage: 'Please provide the case number so I can look up its status.'
          };
        }

        if (input.customerEmail?.trim()) {
          const customerCases = await dependencies.repository.findTimelineInputsByCustomerEmail(input.customerEmail);
          const matchingCase = customerCases.find((candidate) => candidate.caseRecord.caseNumber === caseNumber);
          return matchingCase ? timelineFor(matchingCase, now()) : notFound(caseNumber);
        }

        const timelineInput = await dependencies.repository.findTimelineInput(caseNumber);
        return timelineInput ? timelineFor(timelineInput, now()) : notFound(caseNumber);
      }

      if (!input.customerEmail?.trim()) {
        return notFound(caseNumber);
      }

      const customerCases = await dependencies.repository.findTimelineInputsByCustomerEmail(input.customerEmail);
      if (caseNumber) {
        const matchingCase = customerCases.find((candidate) => candidate.caseRecord.caseNumber === caseNumber);
        return matchingCase ? timelineFor(matchingCase, now()) : notFound(caseNumber);
      }

      if (customerCases.length === 0) {
        return notFound(undefined);
      }
      if (customerCases.length > 1) {
        const caseNumbers = customerCases.map((candidate) => candidate.caseRecord.caseNumber);
        return {
          status: 'NEEDS_DISAMBIGUATION',
          caseNumbers,
          customerMessage: `I found multiple cases associated with your email. Please tell me which case number you mean: ${caseNumbers.join(', ')}.`
        };
      }

      return timelineFor(customerCases[0], now());
    }
  };
}
