import { describe, expect, it } from 'vitest';
import type { CaseLookupRepository, CaseTimelineInput, CaseTimelineRepository } from '../src/cases/repository.js';
import { createLookupCaseTool } from '../src/agent-core/tools/lookup-case.js';
import { createSeedData, stageDurationSeedData } from '../src/db/seed-data.js';

const reference = new Date('2026-08-17T12:00:00.000Z');
const seedData = createSeedData(reference);

function timelineInput(caseNumber: string): CaseTimelineInput {
  const seedCase = seedData.cases.find((candidate) => candidate.caseNumber === caseNumber);
  if (!seedCase) {
    throw new Error(`Missing seeded case ${caseNumber}`);
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

const repository: CaseTimelineRepository & CaseLookupRepository = {
  async findTimelineInput(caseNumber) {
    const seedCase = seedData.cases.find((candidate) => candidate.caseNumber === caseNumber);
    return seedCase ? timelineInput(seedCase.caseNumber) : null;
  },
  async findTimelineInputsByCustomerEmail(customerEmail) {
    return seedData.cases
      .filter((candidate) => candidate.customerEmail === customerEmail.trim().toLowerCase())
      .map((candidate) => timelineInput(candidate.caseNumber));
  }
};

const tool = createLookupCaseTool({ repository, now: () => reference });

describe('lookup_case', () => {
  it('uses the ticket requester email and returns computed, phrase-ready timeline facts', async () => {
    const result = await tool.lookupCase({
      channel: 'ticket',
      scope: 'status',
      customerEmail: 'jordan.lee@othram-demo.test',
      caseNumber: 'oth-2026-0142'
    });

    expect(result).toMatchObject({
      status: 'FOUND',
      timeline: {
        caseNumber: 'OTH-2026-0142',
        currentStage: 'EXTRACTION',
        timelineStatus: 'ON_SCHEDULE',
        eta: { status: 'AVAILABLE', delivery: { weeksFromNow: 3 } }
      }
    });
    if (result.status !== 'FOUND') throw new Error('Expected a found Case.');
    expect(result.customerMessage).toBe(
      'Case OTH-2026-0142 is currently in extraction and has been in this stage for 3 days. The case is currently on schedule. Based on the standard processing timeline, sequencing is expected in about 2 weeks and delivery is expected in about 3 weeks.'
    );
  });

  it('returns an honest not-found result with a specialist offer', async () => {
    const result = await tool.lookupCase({ channel: 'voice', scope: 'status', caseNumber: 'OTH-UNKNOWN' });

    expect(result).toEqual({
      status: 'NOT_FOUND',
      caseNumber: 'OTH-UNKNOWN',
      customerMessage:
        "I can't locate that case. I don't want to guess about its status, but I can connect you with a specialist who can help."
    });
  });

  it('asks a ticket requester with multiple Cases to disambiguate', async () => {
    const result = await tool.lookupCase({
      channel: 'ticket',
      scope: 'status',
      customerEmail: 'maya.collins@othram-demo.test'
    });

    expect(result).toMatchObject({
      status: 'NEEDS_DISAMBIGUATION',
      caseNumbers: ['OTH-2026-0143', 'OTH-2026-0144', 'OTH-2026-0153']
    });
  });

  it('does not disclose information beyond status to a voice caller with only a case number', async () => {
    const result = await tool.lookupCase({
      channel: 'voice',
      scope: 'beyond_status',
      caseNumber: 'OTH-2026-0142'
    });

    expect(result).toEqual({
      status: 'IDENTITY_REQUIRED',
      customerMessage:
        'I can provide a case status with the case number, but anything beyond status requires the email address on file.'
    });
  });
});
