import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentCore, type AgentModel, type AgentModelRequest, type AgentModelResponse } from '../src/agent-core/core.js';
import { createTicketAgentCoreFactory } from '../src/channels/ticket/agent-core.js';
import { LocalTicketGateway } from '../src/channels/ticket/local-ticket-gateway.js';
import type { TicketGateway } from '../src/channels/ticket/gateway.js';
import { TicketPollingWorker } from '../src/channels/ticket/polling-worker.js';
import { createDatabase } from '../src/db/client.js';
import {
  localTicketComments,
  localTicketIdempotency,
  localTicketRequesters,
  localTickets,
  ticketIngestionCursors,
  ticketWorkItems
} from '../src/db/schema.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const database = testDatabaseUrl ? createDatabase(testDatabaseUrl) : undefined;

class ReplyModel implements AgentModel {
  readonly requests: AgentModelRequest[] = [];
  constructor(private readonly escalation = false) {}
  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    this.requests.push(request);
    return {
      responseId: `response-${this.requests.length}`,
      outputText: '',
      toolCalls: [{
        callId: `reply-${this.requests.length}`,
        name: this.escalation ? 'escalate' : 'reply',
        arguments: JSON.stringify(this.escalation ? {
          reason: 'CUSTOMER_REQUESTS_HUMAN', summary: 'Customer asked for a person.', team: 'General Support', emotionalState: 'NEUTRAL'
        } : {
          message: 'Computed case timeline reply.', confidence: 0.9, emotionalState: 'NEUTRAL', knowledgeGroundingDecision: 'NOT_APPLICABLE'
        })
      }]
    };
  }
}

class ScriptedModel implements AgentModel {
  readonly requests: AgentModelRequest[] = [];
  constructor(private readonly calls: AgentModelResponse['toolCalls'][]) {}
  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    this.requests.push(request);
    return {
      responseId: `scripted-${this.requests.length}`,
      outputText: '',
      toolCalls: this.calls.shift() ?? []
    };
  }
}

class PoisonAwareModel implements AgentModel {
  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const inbound = request.messages.at(-1)?.content;
    if (inbound === 'This item is poison.') throw new Error('simulated model failure');
    return {
      responseId: 'healthy-response',
      outputText: '',
      toolCalls: [{
        callId: 'healthy-reply',
        name: 'reply',
        arguments: JSON.stringify({
          message: 'Healthy ticket reply.',
          confidence: 0.9,
          emotionalState: 'NEUTRAL',
          knowledgeGroundingDecision: 'NOT_APPLICABLE'
        })
      }]
    };
  }
}

describeWithDatabase('TicketPollingWorker', () => {
  beforeAll(async () => {
    if (!database) return;
    await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });
  beforeEach(async () => {
    if (!database) return;
    await database.db.delete(ticketWorkItems);
    await database.db.delete(ticketIngestionCursors);
    await database.db.delete(localTicketIdempotency);
    await database.db.delete(localTicketComments);
    await database.db.delete(localTickets);
    await database.db.delete(localTicketRequesters);
  });
  afterAll(async () => database?.close());

  async function setup(input: {
    escalation?: boolean;
    afterGatewayReply?: () => Promise<void> | void;
    beforeGatewayReply?: () => Promise<void> | void;
  } = {}) {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const model = new ReplyModel(input.escalation);
    let now = new Date('2026-08-20T12:00:00.000Z');
    const worker = new TicketPollingWorker({
      database: database.db,
      gateway,
      createAgentCore: () => new AgentCore(model),
      now: () => now,
      leaseMs: 10,
      afterGatewayReply: input.afterGatewayReply,
      beforeGatewayReply: input.beforeGatewayReply
    });
    const ticket = await gateway.createTicket({
      requester: { name: 'Jordan Lee', email: 'jordan@othram-demo.test' },
      subject: 'Case status',
      message: 'Where is case OTH-101?'
    });
    return {
      gateway,
      model,
      worker,
      ticket,
      currentTime: () => now,
      advance: () => { now = new Date(now.getTime() + 11); }
    };
  }

  it('persists a cursor and does not enqueue overlap again after restart', async () => {
    const { worker, ticket, gateway } = await setup();
    expect(await worker.pollOnce()).toMatchObject({ enqueued: 1 });
    await gateway.addRequesterComment(ticket.id, { message: 'Please check again.', idempotencyKey: 'follow-up' });
    const restarted = new TicketPollingWorker({
      database: database!.db, gateway, createAgentCore: () => new AgentCore(new ReplyModel())
    });
    expect(await restarted.pollOnce()).toMatchObject({ enqueued: 1 });
    expect(await restarted.pollOnce()).toMatchObject({ enqueued: 0 });
  });

  it('uses queue order, not lexical provider cursors, for more than nine updates', async () => {
    const { worker, ticket, gateway } = await setup();
    for (let index = 2; index <= 11; index += 1) {
      await gateway.addRequesterComment(ticket.id, { message: `Update ${index}`, idempotencyKey: `update-${index}` });
    }
    await worker.pollOnce();
    const rows = await database!.db.select().from(ticketWorkItems).orderBy(ticketWorkItems.queueOrder);
    expect(rows.map((row) => row.inboundCursor)).toEqual([...rows]
      .sort((left, right) => Number(BigInt(left.inboundCursor) - BigInt(right.inboundCursor)))
      .map((row) => row.inboundCursor));
  });

  it('retries a stale concurrent poll from the durable opaque checkpoint', async () => {
    const { gateway } = await setup();
    let calls = 0;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { release = resolve; });
    let bothStarted!: () => void;
    const both = new Promise<void>((resolve) => { bothStarted = resolve; });
    const slowGateway: Pick<TicketGateway, 'listRequesterUpdates'> = {
      async listRequesterUpdates(input) {
        calls += 1;
        if (calls <= 2) {
          if (calls === 2) bothStarted();
          await started;
        }
        return gateway.listRequesterUpdates(input);
      }
    };
    const makeWorker = () => new TicketPollingWorker({
      database: database!.db,
      gateway: slowGateway as TicketGateway,
      createAgentCore: () => new AgentCore(new ReplyModel())
    });
    const first = makeWorker().pollOnce();
    const second = makeWorker().pollOnce();
    await both;
    release();
    expect((await Promise.all([first, second])).map((result) => result.enqueued).sort()).toEqual([0, 1]);
    expect(calls).toBe(3);
  });

  it('rejects a nonempty gateway page without a durable checkpoint', async () => {
    const { gateway } = await setup();
    const page = await gateway.listRequesterUpdates();
    const invalidGateway = {
      async listRequesterUpdates() {
        return { ...page, nextCursor: null };
      }
    } as TicketGateway;
    const worker = new TicketPollingWorker({
      database: database!.db,
      gateway: invalidGateway,
      createAgentCore: () => new AgentCore(new ReplyModel())
    });

    await expect(worker.pollOnce()).rejects.toThrow('without a durable nextCursor checkpoint');
    expect(await database!.db.select().from(ticketWorkItems)).toHaveLength(0);
    expect(await database!.db.select().from(ticketIngestionCursors)).toHaveLength(0);
  });

  it('leases work to one of two workers and renders only earlier public thread comments', async () => {
    const { worker, model, ticket, gateway } = await setup();
    await gateway.addPublicReply(ticket.id, { message: 'Earlier agent message', idempotencyKey: 'earlier' });
    await gateway.addInternalNote(ticket.id, { message: 'Internal only', idempotencyKey: 'internal' });
    await gateway.addRequesterComment(ticket.id, { message: 'Second customer question', idempotencyKey: 'second' });
    await worker.pollOnce();
    expect(await Promise.all([worker.processOne(), new TicketPollingWorker({
      database: database!.db, gateway, createAgentCore: () => new AgentCore(model)
    }).processOne()])).toEqual(expect.arrayContaining(['REPLIED']));
    // The second work item is serialized behind the first ticket item.
    await worker.processOne();
    expect(model.requests.at(-1)?.messages).toEqual([
      { role: 'user', content: 'Where is case OTH-101?' },
      { role: 'assistant', content: 'Earlier agent message' },
      { role: 'user', content: 'Second customer question' }
    ]);
    expect(model.requests.at(-1)?.messages.some((message) => message.content === 'Internal only')).toBe(false);
  });

  it('retries the delivery crash window with one public reply', async () => {
    let failOnce = true;
    const { worker, gateway, ticket, advance } = await setup({ afterGatewayReply: () => {
      if (failOnce) { failOnce = false; throw new Error('simulated crash'); }
    } });
    await worker.pollOnce();
    await expect(worker.processOne()).rejects.toThrow('simulated crash');
    advance();
    expect(await worker.processOne()).toBe('REPLIED');
    expect((await gateway.getTicket(ticket.id))?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic))
      .toHaveLength(1);
    expect((await gateway.getTicket(ticket.id))?.status).toBe('solved');
  });

  it('continues draining unrelated tickets after an item fails', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const poison = await gateway.createTicket({
      requester: { name: 'Poison Requester', email: 'poison@othram-demo.test' },
      subject: 'Poison ticket',
      message: 'This item is poison.'
    });
    const healthy = await gateway.createTicket({
      requester: { name: 'Healthy Requester', email: 'healthy@othram-demo.test' },
      subject: 'Healthy ticket',
      message: 'Please process this ticket.'
    });
    const worker = new TicketPollingWorker({
      database: database.db,
      gateway,
      createAgentCore: () => new AgentCore(new PoisonAwareModel()),
      leaseMs: 30_000
    });

    await expect(worker.drain()).rejects.toThrow('simulated model failure');
    expect((await gateway.getTicket(poison.id))?.status).toBe('open');
    expect((await gateway.getTicket(healthy.id))?.status).toBe('solved');
    expect((await gateway.getTicket(healthy.id))?.comments.at(-1)?.body).toBe('Healthy ticket reply.');
  });

  it('prioritizes never-attempted work ahead of failed items from a full earlier batch', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    for (let index = 1; index <= 2; index += 1) {
      await gateway.createTicket({
        requester: { name: `Poison ${index}`, email: `poison-${index}@othram-demo.test` },
        subject: `Poison ticket ${index}`,
        message: 'This item is poison.'
      });
    }
    const healthy = await gateway.createTicket({
      requester: { name: 'Healthy Requester', email: 'healthy@othram-demo.test' },
      subject: 'Healthy ticket',
      message: 'Please process this ticket.'
    });
    let now = new Date('2026-08-20T12:00:00.000Z');
    const worker = new TicketPollingWorker({
      database: database.db,
      gateway,
      createAgentCore: () => new AgentCore(new PoisonAwareModel()),
      now: () => now,
      leaseMs: 10,
      pageSize: 100
    });

    await expect(worker.drain({ maxItems: 2 })).rejects.toThrow('Multiple ticket work items failed.');
    now = new Date(now.getTime() + 11);
    expect(await worker.drain({ maxItems: 1 })).toEqual({ enqueued: 0, processed: 1 });
    expect((await gateway.getTicket(healthy.id))?.status).toBe('solved');
  });

  it('gives retries a bounded share while fresh work keeps arriving', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const poison = await gateway.createTicket({
      requester: { name: 'Poison Requester', email: 'poison@othram-demo.test' },
      subject: 'Poison ticket',
      message: 'This item is poison.'
    });
    let now = new Date('2026-08-20T12:00:00.000Z');
    const worker = new TicketPollingWorker({
      database: database.db,
      gateway,
      createAgentCore: () => new AgentCore(new PoisonAwareModel()),
      now: () => now,
      leaseMs: 10,
      pageSize: 100
    });

    await expect(worker.drain({ maxItems: 1 })).rejects.toThrow('simulated model failure');
    for (let index = 1; index <= 100; index += 1) {
      await gateway.createTicket({
        requester: { name: `Fresh ${index}`, email: `fresh-${index}@othram-demo.test` },
        subject: `Fresh ticket ${index}`,
        message: 'Please process this ticket.'
      });
    }
    now = new Date(now.getTime() + 11);
    await expect(worker.drain({ maxItems: 100 })).rejects.toThrow('simulated model failure');
    const [poisonWork] = await database.db
      .select()
      .from(ticketWorkItems)
      .where(eq(ticketWorkItems.ticketId, poison.id));
    expect(poisonWork?.attempts).toBe(2);
    const tickets = await database.db.select().from(localTickets);
    expect(tickets.filter((ticket) => ticket.status === 'solved')).toHaveLength(99);
  });

  it('does not steal READY_TO_SEND work while its delivery lease is live', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => { reached = resolve; });
    const { worker, gateway, currentTime } = await setup({
      beforeGatewayReply: async () => {
        reached();
        await blocked;
      }
    });
    await worker.pollOnce();
    const first = worker.processOne();
    await ready;

    const competingWorker = new TicketPollingWorker({
      database: database!.db,
      gateway,
      createAgentCore: () => new AgentCore(new ReplyModel()),
      now: currentTime,
      leaseMs: 10
    });
    expect(await competingWorker.processOne()).toBeNull();
    release();
    expect(await first).toBe('REPLIED');
  });

  it('fences an expired sender while preserving one visible reply', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => { reached = resolve; });
    const { worker, gateway, ticket, currentTime, advance } = await setup({
      beforeGatewayReply: async () => {
        reached();
        await blocked;
      }
    });
    await worker.pollOnce();
    const staleSender = worker.processOne();
    await ready;
    advance();

    const replacement = new TicketPollingWorker({
      database: database!.db,
      gateway,
      createAgentCore: () => new AgentCore(new ReplyModel()),
      now: currentTime,
      leaseMs: 10
    });
    expect(await replacement.processOne()).toBe('REPLIED');
    release();
    await expect(staleSender).rejects.toThrow('Lost lease while recording delivery');
    expect((await gateway.getTicket(ticket.id))?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic))
      .toHaveLength(1);
  });

  it('ignores agent and internal updates, and parks core escalation without replying', async () => {
    const { worker, gateway, ticket } = await setup({ escalation: true });
    await gateway.addInternalNote(ticket.id, { message: 'Staff note', idempotencyKey: 'note' });
    await gateway.addPublicReply(ticket.id, { message: 'Existing agent reply', idempotencyKey: 'reply' });
    await gateway.addRequesterComment(ticket.id, { message: 'A later question', idempotencyKey: 'later' });
    await worker.pollOnce();
    expect(await worker.processOne()).toBe('ESCALATION_PENDING');
    expect(await worker.processOne()).toBeNull();
    expect((await gateway.getTicket(ticket.id))?.comments.filter((comment) => comment.author === 'agent')).toHaveLength(2);
    const work = await database!.db.select().from(ticketWorkItems);
    expect(work.some((item) => item.status === 'ESCALATION_PENDING')).toBe(true);
    expect(work.some((item) => item.status === 'PENDING')).toBe(true);
  });

  it('runs an immediate lifecycle-managed poll and waits for delivery on stop', async () => {
    let delivered!: () => void;
    const delivery = new Promise<void>((resolve) => { delivered = resolve; });
    const { worker, gateway, ticket } = await setup({ afterGatewayReply: delivered });
    const loop = worker.start({ intervalMs: 60_000 });
    await delivery;
    await loop.stop();

    expect((await gateway.getTicket(ticket.id))?.status).toBe('solved');
    expect((await gateway.getTicket(ticket.id))?.comments.filter((comment) => comment.author === 'agent' && comment.isPublic))
      .toHaveLength(1);
  });

  it('delivers a requester-bound computed case reply through the ticket worker', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await gateway.createTicket({
      requester: { name: 'Jordan Lee', email: 'jordan@othram-demo.test' },
      subject: 'Case status',
      message: 'Where is OTH-101?'
    });
    const model = new ScriptedModel([
      [{ callId: 'lookup', name: 'lookup_case', arguments: JSON.stringify({ caseNumber: 'OTH-101', scope: 'status' }) }],
      [{ callId: 'reply', name: 'reply', arguments: JSON.stringify({
        message: 'Case OTH-101 is in sequencing and is currently on schedule.',
        confidence: 0.95,
        emotionalState: 'NEUTRAL',
        knowledgeGroundingDecision: 'NOT_APPLICABLE'
      }) }]
    ]);
    const lookupInputs: unknown[] = [];
    const worker = new TicketPollingWorker({
      database: database.db,
      gateway,
      createAgentCore: createTicketAgentCoreFactory({
        model,
        lookupCase: {
          async lookupCase(input) {
            lookupInputs.push(input);
            return {
              status: 'FOUND',
              timeline: {} as never,
              customerMessage: 'Case OTH-101 is in sequencing and is currently on schedule.'
            };
          }
        },
        knowledgeSearch: { async search() { throw new Error('Knowledge search was not expected.'); } },
        knowledgeGroundingClassifier: { async classify() { return 'NOT_APPLICABLE'; } }
      })
    });

    expect(await worker.drain()).toEqual({ enqueued: 1, processed: 1 });
    expect(lookupInputs).toEqual([{
      channel: 'ticket',
      scope: 'status',
      caseNumber: 'OTH-101',
      customerEmail: 'jordan@othram-demo.test'
    }]);
    const resolved = await gateway.getTicket(ticket.id);
    expect(resolved?.status).toBe('solved');
    expect(resolved?.comments.at(-1)?.body).toBe('Case OTH-101 is in sequencing and is currently on schedule.');
  });

  it('delivers a cited policy reply through the ticket worker', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await gateway.createTicket({
      requester: { name: 'Jordan Lee', email: 'jordan@othram-demo.test' },
      subject: 'Photo permission',
      message: 'May I publish a case photo?'
    });
    const model = new ScriptedModel([
      [{ callId: 'search', name: 'search_knowledge', arguments: JSON.stringify({ query: 'photo permission policy' }) }],
      [{ callId: 'reply', name: 'reply', arguments: JSON.stringify({
        message: 'Written permission is required. [Media Permission Policy §Publishing case media]',
        confidence: 0.95,
        emotionalState: 'NEUTRAL',
        knowledgeGroundingDecision: 'REQUIRED'
      }) }]
    ]);
    const worker = new TicketPollingWorker({
      database: database.db,
      gateway,
      createAgentCore: createTicketAgentCoreFactory({
        model,
        lookupCase: { async lookupCase() { throw new Error('Case lookup was not expected.'); } },
        knowledgeSearch: {
          async search() {
            return [{
              content: 'Publishing case media requires written permission.',
              citation: {
                document: 'Media Permission Policy',
                section: 'Publishing case media',
                category: 'policy',
                sourcePath: 'media-permission.md'
              },
              similarity: 0.98
            }];
          }
        },
        knowledgeGroundingClassifier: { async classify() { return 'REQUIRED'; } }
      })
    });

    expect(await worker.drain()).toEqual({ enqueued: 1, processed: 1 });
    const resolved = await gateway.getTicket(ticket.id);
    expect(resolved?.status).toBe('solved');
    expect(resolved?.comments.at(-1)?.body)
      .toBe('Written permission is required. [Media Permission Policy §Publishing case media]');
  });
});
