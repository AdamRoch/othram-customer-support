import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AgentModel, AgentModelRequest, AgentModelResponse, KnowledgeGroundingClassifier } from '../agent-core/core.js';
import { createLookupCaseTool } from '../agent-core/tools/lookup-case.js';
import { createCaseTimelineRepository } from '../cases/repository.js';
import { createTicketAgentCoreFactory } from '../channels/ticket/agent-core.js';
import { LocalTicketGateway } from '../channels/ticket/local-ticket-gateway.js';
import { TicketPollingWorker } from '../channels/ticket/polling-worker.js';
import type { createDatabase } from '../db/client.js';
import {
  cases,
  customers,
  localTicketComments,
  localTicketIdempotency,
  localTickets,
  stageDurations,
  ticketIngestionCursors,
  ticketWorkItems
} from '../db/schema.js';
import type { KnowledgeSearchResult, KnowledgeSearchService } from '../knowledge/search.js';

type Database = ReturnType<typeof createDatabase>['db'];

export interface LocalTicketEvalScenarioResult {
  name: 'case_status' | 'photo_permission' | 'dna_reprocessing';
  passed: boolean;
  outcome: 'resolved' | 'escalated';
}

export interface LocalTicketEvalResult {
  providerUse: { zendesk: false; openai: false };
  humanAvoidance: { resolved: number; total: number; rate: string; scope: 'local_eval_only' };
  scenarios: LocalTicketEvalScenarioResult[];
}

export interface RunLocalTicketEvalOptions {
  database: Database;
  /** Test seam used to prove fixture cleanup when an eval run fails. */
  failAfterScenario?: 'case_status' | 'photo_permission' | 'dna_reprocessing';
}

const EVAL_CURSOR = 'local-ticket-eval';
const EVAL_NOW = new Date('2026-08-17T12:00:00.000Z');
const CASE_NUMBER = 'OTHRM-EVAL-CASE';
const CASE_EMAIL = 'eval.case@othram-demo.test';
const MEDIA_POLICY: KnowledgeSearchResult = {
  content: 'Othram-provided case media may be used when written permission is granted for the requested publication.',
  citation: {
    document: 'Media Permission Policy',
    section: 'Publishing case media',
    category: 'policy',
    sourcePath: 'server/src/knowledge/10-media-permission-policy.md'
  },
  similarity: 1
};

class EvalModel implements AgentModel {
  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const latest = request.messages.at(-1)?.content ?? '';
    const hasLookupResult = request.toolOutputs?.some((output) => output.callId === 'lookup-case') ?? false;
    const hasSearchResult = request.toolOutputs?.some((output) => output.callId === 'search-policy') ?? false;

    if (latest.includes('photo')) {
      if (!hasSearchResult) return toolResponse('search-policy', 'search_knowledge', { query: 'photo permission' });
      return toolResponse('reply-photo', 'reply', {
        message: 'You may use the photo with written permission for the requested publication. [Media Permission Policy §Publishing case media]',
        confidence: 0.95,
        emotionalState: 'NEUTRAL',
        knowledgeGroundingDecision: 'REQUIRED'
      });
    }

    if (latest.includes('reprocess') || latest.includes('mismatch')) {
      return toolResponse('escalate-technical', 'escalate', {
        reason: 'TECHNICAL_PROBLEM',
        summary: 'Customer reports a possible DNA mismatch and requests reprocessing.',
        team: 'Technical Team',
        emotionalState: 'NEUTRAL'
      });
    }

    if (!hasLookupResult) {
      return toolResponse('lookup-case', 'lookup_case', { caseNumber: CASE_NUMBER, scope: 'status' });
    }
    const lookupOutput = request.toolOutputs?.find((output) => output.callId === 'lookup-case');
    const customerMessage = lookupOutput ? JSON.parse(lookupOutput.output).customerMessage : undefined;
    if (typeof customerMessage !== 'string') throw new Error('Eval case lookup did not return a customer message.');
    return toolResponse('reply-case', 'reply', {
      message: customerMessage,
      confidence: 0.95,
      emotionalState: 'NEUTRAL',
      knowledgeGroundingDecision: 'NOT_APPLICABLE'
    });
  }
}

function toolResponse(callId: string, name: string, argumentsValue: unknown): AgentModelResponse {
  return { responseId: callId, outputText: '', toolCalls: [{ callId, name, arguments: JSON.stringify(argumentsValue) }] };
}

const evalGroundingClassifier: KnowledgeGroundingClassifier = {
  async classify(messages) {
    return messages.at(-1)?.content.includes('photo') ? 'REQUIRED' : 'NOT_APPLICABLE';
  }
};

const evalKnowledgeSearch: KnowledgeSearchService = {
  async search(query) {
    if (!query.toLowerCase().includes('photo')) throw new Error(`Unexpected deterministic eval search: ${query}`);
    return [MEDIA_POLICY];
  }
};

function evalResult(scenarios: LocalTicketEvalScenarioResult[]): LocalTicketEvalResult {
  const resolved = scenarios.filter((scenario) => scenario.outcome === 'resolved' && scenario.passed).length;
  return {
    providerUse: { zendesk: false, openai: false },
    humanAvoidance: { resolved, total: scenarios.length, rate: `${((resolved / scenarios.length) * 100).toFixed(1)}%`, scope: 'local_eval_only' },
    scenarios
  };
}

async function seedEvalCase(database: Database): Promise<void> {
  await database.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, CASE_EMAIL));
    const customerId = customer?.id ?? (await tx.insert(customers).values({
      name: 'Eval Case Requester', email: CASE_EMAIL, phone: '+1-512-555-0199'
    }).returning({ id: customers.id }))[0]?.id;
    if (!customerId) throw new Error('Could not seed the local eval customer.');
    await tx.insert(stageDurations).values([
      { stage: 'RECEIVED', standardDays: 1 }, { stage: 'EXTRACTION', standardDays: 5 },
      { stage: 'QUANTIFICATION', standardDays: 2 }, { stage: 'LIBRARY_PREP', standardDays: 6 },
      { stage: 'SEQUENCING', standardDays: 3 }, { stage: 'BIOINFORMATICS', standardDays: 2 },
      { stage: 'REVIEW', standardDays: 2 }, { stage: 'DELIVERED', standardDays: 0 }
    ]).onConflictDoNothing();
    await tx.insert(cases).values({
      caseNumber: CASE_NUMBER, customerId, serviceType: 'Forensic DNA identification', currentStage: 'EXTRACTION',
      stageEnteredAt: new Date('2026-08-14T12:00:00.000Z'), submittedAt: new Date('2026-08-13T12:00:00.000Z'), delayed: false, notes: null
    }).onConflictDoUpdate({ target: cases.caseNumber, set: { customerId, currentStage: 'EXTRACTION', stageEnteredAt: new Date('2026-08-14T12:00:00.000Z'), delayed: false } });
  });
}

async function cleanupEvalTickets(database: Database, ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  await database.transaction(async (tx) => {
    for (const ticketId of ticketIds) {
      await tx.delete(ticketWorkItems).where(eq(ticketWorkItems.ticketId, ticketId));
      await tx.delete(localTicketIdempotency).where(eq(localTicketIdempotency.ticketId, ticketId));
      await tx.delete(localTicketComments).where(eq(localTicketComments.ticketId, ticketId));
      await tx.delete(localTickets).where(eq(localTickets.id, ticketId));
    }
    await tx.delete(ticketIngestionCursors).where(eq(ticketIngestionCursors.name, EVAL_CURSOR));
  });
}

export async function runLocalTicketEval(options: RunLocalTicketEvalOptions): Promise<LocalTicketEvalResult> {
  await seedEvalCase(options.database);
  const gateway = new LocalTicketGateway(options.database);
  const ticketIds: string[] = [];
  const worker = new TicketPollingWorker({
    database: options.database,
    gateway,
    cursorName: EVAL_CURSOR,
    now: () => EVAL_NOW,
    createId: randomUUID,
    createAgentCore: createTicketAgentCoreFactory({
      model: new EvalModel(),
      lookupCase: createLookupCaseTool({ repository: createCaseTimelineRepository(options.database), now: () => EVAL_NOW }),
      knowledgeSearch: evalKnowledgeSearch,
      knowledgeGroundingClassifier: evalGroundingClassifier
    })
  });
  const scenarios: LocalTicketEvalScenarioResult[] = [];

  try {
    const statusTicket = await gateway.createTicket({ requester: { name: 'Eval Case Requester', email: CASE_EMAIL }, subject: 'Eval case status', message: `What is the status of ${CASE_NUMBER}?` });
    ticketIds.push(statusTicket.id);
    await worker.drain();
    const statusThread = await gateway.getTicket(statusTicket.id);
    const statusPassed = statusThread?.status === 'solved' && statusThread.comments.at(-1)?.body.includes(CASE_NUMBER) === true;
    scenarios.push({ name: 'case_status', passed: statusPassed, outcome: 'resolved' });
    if (options.failAfterScenario === 'case_status') throw new Error('Injected eval failure after case_status.');

    const photoTicket = await gateway.createTicket({ requester: { name: 'Eval Case Requester', email: CASE_EMAIL }, subject: 'Eval photo permission', message: 'May I publish an Othram photo?' });
    ticketIds.push(photoTicket.id);
    await worker.drain();
    const photoThread = await gateway.getTicket(photoTicket.id);
    const photoReplies = photoThread?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    const photoPassed = photoThread?.status === 'solved' && photoReplies.length === 1 && photoReplies[0]?.body.includes('[Media Permission Policy §Publishing case media]') === true;
    scenarios.push({ name: 'photo_permission', passed: photoPassed, outcome: 'resolved' });
    if (options.failAfterScenario === 'photo_permission') throw new Error('Injected eval failure after photo_permission.');

    const technicalTicket = await gateway.createTicket({ requester: { name: 'Eval Case Requester', email: CASE_EMAIL }, subject: 'Eval DNA reprocessing', message: 'My DNA result looks like a mismatch. Please reprocess it.' });
    ticketIds.push(technicalTicket.id);
    await worker.drain();
    const technicalThread = await gateway.getTicket(technicalTicket.id);
    const internalNotes = technicalThread?.comments.filter((comment) => comment.author === 'agent' && !comment.isPublic) ?? [];
    const acknowledgments = technicalThread?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    const technicalPassed = technicalThread?.status === 'open' && technicalThread.team === 'Technical Team' &&
      technicalThread.tags.includes('ai-escalated') && technicalThread.tags.includes('ai-escalated:technical-problem') &&
      internalNotes.length === 1 && acknowledgments.length === 1;
    scenarios.push({ name: 'dna_reprocessing', passed: technicalPassed, outcome: 'escalated' });
    if (options.failAfterScenario === 'dna_reprocessing') throw new Error('Injected eval failure after dna_reprocessing.');

    if (scenarios.some((scenario) => !scenario.passed)) throw new Error('One or more local ticket eval scenarios failed.');
    return evalResult(scenarios);
  } finally {
    await cleanupEvalTickets(options.database, ticketIds);
  }
}

export function formatLocalTicketEval(result: LocalTicketEvalResult): string {
  const rows = result.scenarios.map((scenario) => `${scenario.passed ? 'PASS' : 'FAIL'} ${scenario.name} (${scenario.outcome})`);
  return [
    'Local Ticket Evaluation',
    'Zendesk not used',
    'OpenAI not used',
    ...rows,
    `Human avoidance: ${result.humanAvoidance.resolved}/${result.humanAvoidance.total} (${result.humanAvoidance.rate}) — local eval only; not production performance.`
  ].join('\n');
}
