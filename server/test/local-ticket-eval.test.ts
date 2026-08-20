import { fileURLToPath } from 'node:url';
import { eq, like } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalTicketGateway } from '../src/channels/ticket/local-ticket-gateway.js';
import { runLocalTicketEval } from '../src/eval/local-ticket-eval.js';
import { createDatabase } from '../src/db/client.js';
import {
  cases,
  customers,
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

describeWithDatabase('local ticket eval', () => {
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
    await database.db.delete(cases).where(like(cases.caseNumber, 'OTHRM-EVAL-%'));
    await database.db.delete(customers).where(like(customers.email, 'eval.case+%@othram-demo.test'));
  });

  afterAll(async () => database?.close());

  async function expectNoEvalFixtures(): Promise<void> {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    expect(await database.db.select().from(localTickets).where(like(localTickets.subject, 'Eval %'))).toHaveLength(0);
    expect(await database.db.select().from(ticketWorkItems)).toHaveLength(0);
    expect(await database.db.select().from(ticketIngestionCursors).where(like(ticketIngestionCursors.name, 'local-ticket-eval:%'))).toHaveLength(0);
    expect(await database.db.select().from(cases).where(like(cases.caseNumber, 'OTHRM-EVAL-%'))).toHaveLength(0);
    expect(await database.db.select().from(customers).where(like(customers.email, 'eval.case+%@othram-demo.test'))).toHaveLength(0);
  }

  it('is deterministic across runs and cleans its fixtures', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const first = await runLocalTicketEval({ database: database.db });
    const second = await runLocalTicketEval({ database: database.db });
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
    await expectNoEvalFixtures();
  });

  it('cleans every fixture after an injected failure', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    await expect(runLocalTicketEval({ database: database.db, failAfterScenario: 'photo_permission' }))
      .rejects.toThrow('Injected eval failure');
    await expectNoEvalFixtures();
  });

  it('does not reply to unrelated tickets even beyond one polling page', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const unrelated = await Promise.all(Array.from({ length: 51 }, (_, index) => gateway.createTicket({
      requester: { name: `Unrelated ${index}`, email: `unrelated-${index}@othram-demo.test` },
      subject: `Unrelated ${index}`,
      message: `Unrelated requester update ${index}`
    })));

    await expect(runLocalTicketEval({ database: database.db })).resolves.toMatchObject({
      scenarios: expect.arrayContaining([expect.objectContaining({ name: 'dna_reprocessing', passed: true })])
    });
    for (const ticket of unrelated) {
      const thread = await gateway.getTicket(ticket.id);
      expect(thread?.status).toBe('open');
      expect(thread?.comments.filter((comment) => comment.author === 'agent')).toHaveLength(0);
    }
    await expectNoEvalFixtures();
    await database.db.delete(localTicketComments).where(eq(localTicketComments.author, 'requester'));
    await database.db.delete(localTickets);
    await database.db.delete(localTicketRequesters);
  });
});
