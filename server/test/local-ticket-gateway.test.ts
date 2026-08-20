import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalTicketGateway } from '../src/channels/ticket/local-ticket-gateway.js';
import { TicketGatewayIdempotencyConflictError } from '../src/channels/ticket/gateway.js';
import { createDatabase } from '../src/db/client.js';
import {
  localTicketComments,
  localTicketIdempotency,
  localTicketRequesters,
  localTickets
} from '../src/db/schema.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
if (testDatabaseUrl) {
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (!/(?:^|[_-])test(?:$|[_-])/.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL must name an isolated test database.');
  }
}
const database = testDatabaseUrl ? createDatabase(testDatabaseUrl) : undefined;

describeWithDatabase('LocalTicketGateway', () => {
  beforeAll(async () => {
    if (!database) return;
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
    });
  });

  beforeEach(async () => {
    if (!database) return;
    await database.db.delete(localTicketIdempotency);
    await database.db.delete(localTicketComments);
    await database.db.delete(localTickets);
    await database.db.delete(localTicketRequesters);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('persists ordered requester updates, full threads, and idempotent ticket actions', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await gateway.createTicket({
      requester: { name: 'Jordan Lee', email: 'Jordan.Lee@othram-demo.test' },
      subject: 'Case update',
      message: 'Where is my Case?'
    });

    const initialUpdates = await gateway.listRequesterUpdates();
    expect(initialUpdates.updates).toHaveLength(1);
    expect(initialUpdates.updates[0]).toMatchObject({
      ticket: {
        id: ticket.id,
        requester: { name: 'Jordan Lee', email: 'jordan.lee@othram-demo.test' }
      },
      comment: { author: 'requester', isPublic: true, body: 'Where is my Case?' }
    });

    const reply = await gateway.addPublicReply(ticket.id, {
      message: 'I can help with that.',
      idempotencyKey: 'reply-1'
    });
    expect(await gateway.addPublicReply(ticket.id, {
      message: 'I can help with that.',
      idempotencyKey: 'reply-1'
    })).toEqual(reply);
    await gateway.addInternalNote(ticket.id, {
      message: 'Looked up the Case timeline.',
      idempotencyKey: 'note-1'
    });
    const routing = await gateway.updateTicket(ticket.id, {
      addTags: ['ai-handled', 'case-status'],
      team: 'General Support',
      status: 'solved',
      idempotencyKey: 'routing-1'
    });
    expect(await gateway.updateTicket(ticket.id, {
      addTags: ['ai-handled', 'case-status'],
      team: 'General Support',
      status: 'solved',
      idempotencyKey: 'routing-1'
    })).toEqual(routing);
    await expect(gateway.updateTicket(ticket.id, {
      addTags: ['different-input'],
      idempotencyKey: 'routing-1'
    })).rejects.toBeInstanceOf(TicketGatewayIdempotencyConflictError);

    const requesterUpdate = await gateway.addRequesterComment(ticket.id, {
      message: 'Thank you, that answers my question.',
      idempotencyKey: 'requester-2'
    });
    expect(await gateway.addRequesterComment(ticket.id, {
      message: 'Thank you, that answers my question.',
      idempotencyKey: 'requester-2'
    })).toEqual(requesterUpdate);
    expect(requesterUpdate.ticket.comments.map((comment) => comment.body)).toEqual([
      'Where is my Case?',
      'I can help with that.',
      'Looked up the Case timeline.',
      'Thank you, that answers my question.'
    ]);
    expect(requesterUpdate.ticket).toMatchObject({
      status: 'solved',
      team: 'General Support',
      tags: ['ai-handled', 'case-status']
    });

    const restartedGateway = new LocalTicketGateway(database.db);
    const afterCursor = await restartedGateway.listRequesterUpdates({
      cursor: initialUpdates.updates[0]!.cursor
    });
    expect(afterCursor).toMatchObject({
      updates: [{ cursor: requesterUpdate.cursor, comment: { body: 'Thank you, that answers my question.' } }],
      nextCursor: null
    });
    expect(await restartedGateway.getTicket(ticket.id)).toEqual(requesterUpdate.ticket);
  });
});
