import { fileURLToPath } from 'node:url';
import { eq, like } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalTicketGateway } from '../src/channels/ticket/local-ticket-gateway.js';
import { stageDurationSeedData } from '../src/db/seed-data.js';
import { runLocalTicketEval } from '../src/eval/local-ticket-eval.js';
import { createDatabase } from '../src/db/client.js';
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
} from '../src/db/schema.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const database = testDatabaseUrl ? createDatabase(testDatabaseUrl) : undefined;
const evalRequesterPattern = 'eval.case+%@othram-demo.test';

interface PreservedWork {
  ticketId: string;
  workItemId: string;
  requesterEmail: string;
}

describeWithDatabase('local ticket eval', () => {
  let preserved: PreservedWork | undefined;

  beforeAll(async () => {
    if (!database) return;
    await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });

  beforeEach(async () => {
    if (!database) return;
    await cleanupLeakedEvalFixtures();
    await ensurePreservedTerminalWork();
  });

  afterAll(async () => {
    if (!database) return;
    await cleanupPreservedTerminalWork();
    await database.close();
  });

  async function cleanupLeakedEvalFixtures(): Promise<void> {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const fixtures = await database.db
      .select({ id: localTickets.id })
      .from(localTickets)
      .innerJoin(localTicketRequesters, eq(localTickets.requesterId, localTicketRequesters.id))
      .where(like(localTicketRequesters.email, evalRequesterPattern));
    for (const fixture of fixtures) {
      await database.db.delete(ticketWorkItems).where(eq(ticketWorkItems.ticketId, fixture.id));
      await database.db.delete(localTicketIdempotency).where(eq(localTicketIdempotency.ticketId, fixture.id));
      await database.db.delete(localTicketComments).where(eq(localTicketComments.ticketId, fixture.id));
      await database.db.delete(localTickets).where(eq(localTickets.id, fixture.id));
    }
    await database.db.delete(localTicketRequesters).where(like(localTicketRequesters.email, evalRequesterPattern));
    await database.db.delete(ticketIngestionCursors).where(like(ticketIngestionCursors.name, 'local-ticket-eval:%'));
    await database.db.delete(cases).where(like(cases.caseNumber, 'OTHRM-EVAL-%'));
    await database.db.delete(customers).where(like(customers.email, evalRequesterPattern));
  }

  async function ensurePreservedTerminalWork(): Promise<void> {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    if (preserved) {
      const [existing] = await database.db.select({ id: ticketWorkItems.id })
        .from(ticketWorkItems).where(eq(ticketWorkItems.id, preserved.workItemId));
      if (existing) return;
    }
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await gateway.createTicket({
      requester: { name: 'Preserved Test Requester', email: 'preserved-terminal@othram-demo.test' },
      subject: 'Preserved terminal ticket',
      message: 'This durable work item must survive the eval.'
    });
    const inbound = ticket.comments[0];
    if (!inbound) throw new Error('Preserved ticket did not have its requester comment.');
    const [workItem] = await database.db.insert(ticketWorkItems).values({
      ticketId: ticket.id,
      inboundCommentId: inbound.id,
      inboundCursor: `preserved:${ticket.id}`,
      status: 'REPLIED',
      replyText: 'Already delivered before the eval.',
      replyIdempotencyKey: `preserved:${ticket.id}:reply`
    }).returning({ id: ticketWorkItems.id });
    if (!workItem) throw new Error('Could not create preserved terminal work.');
    preserved = { ticketId: ticket.id, workItemId: workItem.id, requesterEmail: ticket.requester.email };
  }

  async function cleanupPreservedTerminalWork(): Promise<void> {
    if (!database || !preserved) return;
    await database.db.delete(ticketWorkItems).where(eq(ticketWorkItems.id, preserved.workItemId));
    await database.db.delete(localTicketIdempotency).where(eq(localTicketIdempotency.ticketId, preserved.ticketId));
    await database.db.delete(localTicketComments).where(eq(localTicketComments.ticketId, preserved.ticketId));
    await database.db.delete(localTickets).where(eq(localTickets.id, preserved.ticketId));
    await database.db.delete(localTicketRequesters).where(eq(localTicketRequesters.email, preserved.requesterEmail));
  }

  async function expectNoEvalFixtures(fixtureTicketIds: readonly string[]): Promise<void> {
    if (!database || !preserved) throw new Error('TEST_DATABASE_URL was not configured.');
    const fixtureTickets = await database.db
      .select({ id: localTickets.id })
      .from(localTickets)
      .innerJoin(localTicketRequesters, eq(localTickets.requesterId, localTicketRequesters.id))
      .where(like(localTicketRequesters.email, evalRequesterPattern));
    expect(fixtureTickets).toHaveLength(0);
    for (const ticketId of fixtureTicketIds) {
      expect(await database.db.select({ id: ticketWorkItems.id }).from(ticketWorkItems)
        .where(eq(ticketWorkItems.ticketId, ticketId))).toHaveLength(0);
    }
    expect(await database.db.select({ id: localTicketRequesters.id }).from(localTicketRequesters)
      .where(like(localTicketRequesters.email, evalRequesterPattern))).toHaveLength(0);
    expect(await database.db.select({ name: ticketIngestionCursors.name }).from(ticketIngestionCursors)
      .where(like(ticketIngestionCursors.name, 'local-ticket-eval:%'))).toHaveLength(0);
    expect(await database.db.select({ id: cases.id }).from(cases)
      .where(like(cases.caseNumber, 'OTHRM-EVAL-%'))).toHaveLength(0);
    expect(await database.db.select({ id: customers.id }).from(customers)
      .where(like(customers.email, evalRequesterPattern))).toHaveLength(0);

    const [preservedWork] = await database.db.select().from(ticketWorkItems)
      .where(eq(ticketWorkItems.id, preserved.workItemId));
    expect(preservedWork?.status).toBe('REPLIED');
    const preservedThread = await new LocalTicketGateway(database.db).getTicket(preserved.ticketId);
    expect(preservedThread?.comments.filter((comment) => comment.author === 'agent')).toHaveLength(0);
  }

  function trackedEvalFixtureIds(): { ids: string[]; onFixtureTicketCreated: (ticketId: string) => void } {
    const ids: string[] = [];
    return { ids, onFixtureTicketCreated: (ticketId) => ids.push(ticketId) };
  }

  it('is deterministic across runs and cleans only its fixtures', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const firstFixtures = trackedEvalFixtureIds();
    const first = await runLocalTicketEval({ database: database.db, ...firstFixtures });
    const secondFixtures = trackedEvalFixtureIds();
    const second = await runLocalTicketEval({ database: database.db, ...secondFixtures });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      providerUse: { zendesk: false, openai: false },
      humanAvoidance: { resolved: 2, total: 3, rate: '66.7%', scope: 'local_eval_only' },
      scenarios: [
        { name: 'case_status', passed: true, outcome: 'resolved' },
        { name: 'photo_permission', passed: true, outcome: 'resolved' },
        { name: 'dna_reprocessing', passed: true, outcome: 'escalated' }
      ]
    });
    await expectNoEvalFixtures([...firstFixtures.ids, ...secondFixtures.ids]);
  });

  it('cleans every fixture after an injected failure', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const fixtures = trackedEvalFixtureIds();
    await expect(runLocalTicketEval({ database: database.db, failAfterScenario: 'photo_permission', ...fixtures }))
      .rejects.toThrow('Injected eval failure');
    await expectNoEvalFixtures(fixtures.ids);
  });

  it('cleans the case fixture when initialization fails after seeding', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const fixtures = trackedEvalFixtureIds();
    await expect(runLocalTicketEval({ database: database.db, failAfterCaseSeed: true, ...fixtures }))
      .rejects.toThrow('Injected eval failure after case seed');
    await expectNoEvalFixtures(fixtures.ids);
  });

  it('fails closed when canonical stage defaults are missing', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const stage = stageDurationSeedData[0]!;
    const [removed] = await database.db.delete(stageDurations).where(eq(stageDurations.stage, stage.stage)).returning();
    try {
      await expect(runLocalTicketEval({ database: database.db })).rejects.toThrow(
        `missing or has non-canonical stage durations for ${stage.stage}=${stage.standardDays}`
      );
      await expectNoEvalFixtures([]);
    } finally {
      if (removed) await database.db.insert(stageDurations).values(removed).onConflictDoNothing();
    }
  });

  it('fails closed when an existing stage duration differs from the canonical default', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const stage = stageDurationSeedData[1]!;
    const [original] = await database.db.update(stageDurations)
      .set({ standardDays: stage.standardDays + 1 })
      .where(eq(stageDurations.stage, stage.stage))
      .returning();
    try {
      await expect(runLocalTicketEval({ database: database.db })).rejects.toThrow(
        `missing or has non-canonical stage durations for ${stage.stage}=${stage.standardDays}`
      );
      await expectNoEvalFixtures([]);
    } finally {
      if (original) await database.db.update(stageDurations)
        .set({ standardDays: stage.standardDays })
        .where(eq(stageDurations.stage, stage.stage));
    }
  });
});
