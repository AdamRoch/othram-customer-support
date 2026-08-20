import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import type { AgentModel, AgentModelRequest, AgentModelResponse, KnowledgeGroundingClassifier } from '../agent-core/core.js';
import { createLookupCaseTool } from '../agent-core/tools/lookup-case.js';
import { createCaseTimelineRepository } from '../cases/repository.js';
import { createTicketAgentCoreFactory } from '../channels/ticket/agent-core.js';
import { LocalTicketGateway } from '../channels/ticket/local-ticket-gateway.js';
import type {
  TicketActionOptions,
  TicketComment,
  TicketEscalation,
  TicketGateway,
  TicketThread
} from '../channels/ticket/gateway.js';
import { TicketPollingWorker } from '../channels/ticket/polling-worker.js';
import type { createDatabase } from '../db/client.js';
import { stageDurationSeedData } from '../db/seed-data.js';
import {
  cases,
  customers,
  localTicketComments,
  localTicketIdempotency,
  localTicketRequesters,
  localTickets,
  stageDurations,
  ticketIngestionCursors,
  ticketWorkItems
} from '../db/schema.js';
import type { KnowledgeSearchResult, KnowledgeSearchService } from '../knowledge/search.js';
import { loadKnowledgeChunks } from '../knowledge/chunking.js';

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

export interface DeterministicLocalTicketEvalResult {
  scoreboard: LocalTicketEvalResult;
  runCount: 2;
  identical: true;
}

export interface RunLocalTicketEvalOptions {
  database: Database;
  /** Test seam used to prove fixture cleanup when an eval run fails. */
  failAfterScenario?: 'case_status' | 'photo_permission' | 'dna_reprocessing';
  /** Test seam used to prove cleanup begins before eval initialization. */
  failAfterCaseSeed?: boolean;
  /** Test seam used to verify durable work cleanup for exactly the fixture tickets created by this run. */
  onFixtureTicketCreated?: (ticketId: string) => void;
}

const EVAL_NOW = new Date('2026-08-17T12:00:00.000Z');
class EvalModel implements AgentModel {
  constructor(private readonly caseNumber: string) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const latest = request.messages.at(-1)?.content ?? '';
    const hasLookupResult = request.toolOutputs?.some((output) => output.callId === 'lookup-case') ?? false;
    const hasSearchResult = request.toolOutputs?.some((output) => output.callId === 'search-policy') ?? false;

    if (latest.includes('photo')) {
      if (!hasSearchResult) return toolResponse('search-policy', 'search_knowledge', { query: 'photo permission' });
      return toolResponse('reply-photo', 'reply', {
        message: 'Permission is granted for your requested use of the Othram-provided media. [Media Permission Policy §Policy]',
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
      return toolResponse('lookup-case', 'lookup_case', { caseNumber: this.caseNumber, scope: 'status' });
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

async function createEvalKnowledgeSearch(): Promise<KnowledgeSearchService> {
  const policy = (await loadKnowledgeChunks()).find((chunk) =>
    chunk.documentTitle === 'Media Permission Policy' && chunk.sectionTitle === 'Policy'
  );
  if (!policy) throw new Error('The local Media Permission Policy chunk is missing.');
  const result: KnowledgeSearchResult = {
    content: policy.content,
    citation: {
      document: policy.documentTitle,
      section: policy.sectionTitle,
      category: policy.documentSection,
      sourcePath: policy.sourcePath
    },
    similarity: 1
  };
  return {
    async search(query) {
      if (!query.toLowerCase().includes('photo')) throw new Error(`Unexpected deterministic eval search: ${query}`);
      return [result];
    }
  };
}

function evalResult(scenarios: LocalTicketEvalScenarioResult[]): LocalTicketEvalResult {
  const resolved = scenarios.filter((scenario) => scenario.outcome === 'resolved' && scenario.passed).length;
  return {
    providerUse: { zendesk: false, openai: false },
    humanAvoidance: { resolved, total: scenarios.length, rate: `${((resolved / scenarios.length) * 100).toFixed(1)}%`, scope: 'local_eval_only' },
    scenarios
  };
}

/**
 * This limits gateway IO to fixture tickets and provides the worker's matching
 * claim scope. The CLI still requires a dedicated eval DB as a second boundary.
 */
class EvalOnlyTicketGateway implements TicketGateway {
  private readonly allowedTicketIds = new Set<string>();

  constructor(private readonly delegate: LocalTicketGateway) {}

  async listRequesterUpdates(input?: { cursor?: string; limit?: number }) {
    // A normal database can have an arbitrarily long history before this run's
    // first fixture. Advance through it inside the adapter rather than letting
    // one worker poll stop before reaching the owned ticket.
    let cursor = input?.cursor;
    for (;;) {
      const page = await this.delegate.listRequesterUpdates({ ...input, cursor });
      const owned = page.updates.filter((update) => this.allowedTicketIds.has(update.ticket.id));
      if (owned.length > 0 || page.updates.length === 0 || page.nextCursor === null || page.nextCursor === cursor) {
        return { ...page, updates: owned };
      }
      cursor = page.nextCursor;
    }
  }

  async getTicket(ticketId: string): Promise<TicketThread | null> {
    this.requireAllowed(ticketId);
    return this.delegate.getTicket(ticketId);
  }

  async createTicket(input: { requester: { name: string; email: string }; subject: string; message: string }) {
    const ticket = await this.delegate.createTicket(input);
    this.allowedTicketIds.add(ticket.id);
    return ticket;
  }

  async addRequesterComment(ticketId: string, input: { message: string } & TicketActionOptions) {
    this.requireAllowed(ticketId);
    return this.delegate.addRequesterComment(ticketId, input);
  }

  async addPublicReply(ticketId: string, input: { message: string } & TicketActionOptions): Promise<TicketComment> {
    this.requireAllowed(ticketId);
    return this.delegate.addPublicReply(ticketId, input);
  }

  async addInternalNote(ticketId: string, input: { message: string } & TicketActionOptions): Promise<TicketComment> {
    this.requireAllowed(ticketId);
    return this.delegate.addInternalNote(ticketId, input);
  }

  async updateTicket(ticketId: string, input: {
    addTags?: string[]; team?: TicketThread['team']; status?: TicketThread['status'];
  } & TicketActionOptions) {
    this.requireAllowed(ticketId);
    return this.delegate.updateTicket(ticketId, input);
  }

  async applyEscalation(ticketId: string, input: TicketEscalation) {
    this.requireAllowed(ticketId);
    return this.delegate.applyEscalation(ticketId, input);
  }

  claimTicketIds(): readonly string[] {
    return [...this.allowedTicketIds];
  }

  private requireAllowed(ticketId: string): void {
    if (!this.allowedTicketIds.has(ticketId)) throw new Error(`Eval cannot access non-owned ticket ${ticketId}.`);
  }
}

async function seedEvalCase(database: Database, caseNumber: string, caseEmail: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, caseEmail));
    const customerId = customer?.id ?? (await tx.insert(customers).values({
      name: 'Eval Case Requester', email: caseEmail, phone: '+1-512-555-0199'
    }).returning({ id: customers.id }))[0]?.id;
    if (!customerId) throw new Error('Could not seed the local eval customer.');
    await tx.insert(cases).values({
      caseNumber, customerId, serviceType: 'Forensic DNA identification', currentStage: 'EXTRACTION',
      stageEnteredAt: new Date('2026-08-14T12:00:00.000Z'), submittedAt: new Date('2026-08-13T12:00:00.000Z'), delayed: false, notes: null
    }).onConflictDoNothing();
  });
}

async function requireCanonicalStageDurations(database: Database): Promise<void> {
  const configured = new Map((await database.select({
    stage: stageDurations.stage,
    standardDays: stageDurations.standardDays
  }).from(stageDurations)).map((duration) => [duration.stage, duration.standardDays]));
  const invalid = stageDurationSeedData.filter((expected) => configured.get(expected.stage) !== expected.standardDays);
  if (invalid.length > 0) {
    throw new Error(
      `Eval database is missing or has non-canonical stage durations for ${invalid
        .map((expected) => `${expected.stage}=${expected.standardDays}`)
        .join(', ')}. Apply the stage-duration defaults migration or restore canonical values in EVAL_DATABASE_URL.`
    );
  }
}

async function cleanupEvalCase(database: Database, caseNumber: string, caseEmail: string): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.delete(cases).where(eq(cases.caseNumber, caseNumber));
    await tx.delete(customers).where(eq(customers.email, caseEmail));
  });
}

async function cleanupEvalTickets(
  database: Database,
  ticketIds: string[],
  cursorName: string,
  requesterEmail: string
): Promise<void> {
  await database.transaction(async (tx) => {
    for (const ticketId of ticketIds) {
      await tx.delete(ticketWorkItems).where(eq(ticketWorkItems.ticketId, ticketId));
      await tx.delete(localTicketIdempotency).where(eq(localTicketIdempotency.ticketId, ticketId));
      await tx.delete(localTicketComments).where(eq(localTicketComments.ticketId, ticketId));
      await tx.delete(localTickets).where(eq(localTickets.id, ticketId));
    }
    await tx.delete(localTicketRequesters).where(eq(localTicketRequesters.email, requesterEmail));
    await tx.delete(ticketIngestionCursors).where(eq(ticketIngestionCursors.name, cursorName));
  });
}

export async function runLocalTicketEval(options: RunLocalTicketEvalOptions): Promise<LocalTicketEvalResult> {
  const runId = randomUUID();
  const caseNumber = `OTHRM-EVAL-${runId.toUpperCase()}`;
  const caseEmail = `eval.case+${runId}@othram-demo.test`;
  const cursorName = `local-ticket-eval:${randomUUID()}`;
  const ticketIds: string[] = [];
  let seeded = false;

  try {
    await requireCanonicalStageDurations(options.database);
    await seedEvalCase(options.database, caseNumber, caseEmail);
    seeded = true;
    if (options.failAfterCaseSeed) throw new Error('Injected eval failure after case seed.');
    const knowledgeSearch = await createEvalKnowledgeSearch();
    const gateway = new EvalOnlyTicketGateway(new LocalTicketGateway(options.database));
    const worker = new TicketPollingWorker({
      database: options.database,
      gateway,
      cursorName,
      now: () => EVAL_NOW,
      createId: randomUUID,
      claimTicketIds: () => gateway.claimTicketIds(),
      createAgentCore: createTicketAgentCoreFactory({
        model: new EvalModel(caseNumber),
        lookupCase: createLookupCaseTool({ repository: createCaseTimelineRepository(options.database), now: () => EVAL_NOW }),
        knowledgeSearch,
        knowledgeGroundingClassifier: evalGroundingClassifier
      })
    });
    const scenarios: LocalTicketEvalScenarioResult[] = [];

    const statusTicket = await gateway.createTicket({ requester: { name: 'Eval Case Requester', email: caseEmail }, subject: 'Eval case status', message: `What is the status of ${caseNumber}?` });
    ticketIds.push(statusTicket.id);
    options.onFixtureTicketCreated?.(statusTicket.id);
    await worker.drain();
    const statusThread = await gateway.getTicket(statusTicket.id);
    const statusReplies = statusThread?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    await worker.drain();
    const statusAfterRedrain = await gateway.getTicket(statusTicket.id);
    const statusRepliesAfterRedrain = statusAfterRedrain?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    const statusPassed = statusThread?.status === 'solved' && statusReplies.length === 1 &&
      statusReplies[0]?.body.includes(caseNumber) === true &&
      statusReplies[0]?.body.includes('currently in extraction') === true &&
      statusReplies[0]?.body.includes('Based on the standard processing timeline') === true &&
      statusRepliesAfterRedrain.length === 1;
    scenarios.push({ name: 'case_status', passed: statusPassed, outcome: 'resolved' });
    if (options.failAfterScenario === 'case_status') throw new Error('Injected eval failure after case_status.');

    const photoTicket = await gateway.createTicket({ requester: { name: 'Eval Case Requester', email: caseEmail }, subject: 'Eval photo permission', message: 'May I publish an Othram photo?' });
    ticketIds.push(photoTicket.id);
    options.onFixtureTicketCreated?.(photoTicket.id);
    await worker.drain();
    const photoThread = await gateway.getTicket(photoTicket.id);
    const photoReplies = photoThread?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    await worker.drain();
    const photoAfterRedrain = await gateway.getTicket(photoTicket.id);
    const photoRepliesAfterRedrain = photoAfterRedrain?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    const photoPassed = photoThread?.status === 'solved' && photoReplies.length === 1 &&
      photoReplies[0]?.body.includes('[Media Permission Policy §Policy]') === true && photoRepliesAfterRedrain.length === 1;
    scenarios.push({ name: 'photo_permission', passed: photoPassed, outcome: 'resolved' });
    if (options.failAfterScenario === 'photo_permission') throw new Error('Injected eval failure after photo_permission.');

    const technicalTicket = await gateway.createTicket({ requester: { name: 'Eval Case Requester', email: caseEmail }, subject: 'Eval DNA reprocessing', message: 'My DNA result looks like a mismatch. Please reprocess it.' });
    ticketIds.push(technicalTicket.id);
    options.onFixtureTicketCreated?.(technicalTicket.id);
    await worker.drain();
    const technicalThread = await gateway.getTicket(technicalTicket.id);
    const internalNotes = technicalThread?.comments.filter((comment) => comment.author === 'agent' && !comment.isPublic) ?? [];
    const acknowledgments = technicalThread?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    await worker.drain();
    const technicalAfterRedrain = await gateway.getTicket(technicalTicket.id);
    const acknowledgmentsAfterRedrain = technicalAfterRedrain?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic) ?? [];
    const escalationNote = internalNotes.length === 1 ? JSON.parse(internalNotes[0]!.body) as Record<string, unknown> : undefined;
    const technicalPassed = technicalThread?.status === 'open' && technicalThread.team === 'Technical Team' &&
      technicalThread.tags.includes('ai-escalated') && technicalThread.tags.includes('ai-escalated:technical-problem') &&
      escalationNote?.reason === 'TECHNICAL_PROBLEM' && Array.isArray(escalationNote.conversation) &&
      acknowledgments.length === 1 && acknowledgments[0]?.body ===
        "I'm sorry this needs specialist review. I've routed your request to the appropriate Othram team for review." &&
      acknowledgmentsAfterRedrain.length === 1;
    scenarios.push({ name: 'dna_reprocessing', passed: technicalPassed, outcome: 'escalated' });
    if (options.failAfterScenario === 'dna_reprocessing') throw new Error('Injected eval failure after dna_reprocessing.');

    if (scenarios.some((scenario) => !scenario.passed)) throw new Error('One or more local ticket eval scenarios failed.');
    return evalResult(scenarios);
  } finally {
    await cleanupEvalTickets(options.database, ticketIds, cursorName, caseEmail);
    if (seeded) await cleanupEvalCase(options.database, caseNumber, caseEmail);
  }
}

export async function runDeterministicLocalTicketEval(
  options: Pick<RunLocalTicketEvalOptions, 'database'>
): Promise<DeterministicLocalTicketEvalResult> {
  const first = await runLocalTicketEval(options);
  const second = await runLocalTicketEval(options);
  if (!isDeepStrictEqual(first, second)) {
    throw new Error('Local ticket evaluation produced different scoreboards across two runs.');
  }
  return { scoreboard: first, runCount: 2, identical: true };
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
