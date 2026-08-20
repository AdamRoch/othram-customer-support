import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForBlockedCursorInsert(): Promise<void> {
  if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await database.db.execute(sql<{ blocked: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = 99123
          AND objid = 1
          AND NOT granted
      ) AS blocked
    `);
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the first cursor insert to block.');
}

describeWithDatabase('LocalTicketGateway', () => {
  beforeAll(async () => {
    if (!database) return;
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
    });
    await database.db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION local_ticket_test_cursor_block()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.body = '__cursor_first__' THEN
          PERFORM pg_advisory_xact_lock(99123, 1);
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER local_ticket_test_cursor_block
      BEFORE INSERT ON local_ticket_comments
      FOR EACH ROW EXECUTE FUNCTION local_ticket_test_cursor_block();
    `));
  });

  beforeEach(async () => {
    if (!database) return;
    await database.db.delete(localTicketIdempotency);
    await database.db.delete(localTicketComments);
    await database.db.delete(localTickets);
    await database.db.delete(localTicketRequesters);
  });

  afterAll(async () => {
    if (!database) return;
    await database.db.execute(sql.raw(`
      DROP TRIGGER IF EXISTS local_ticket_test_cursor_block ON local_ticket_comments;
      DROP FUNCTION IF EXISTS local_ticket_test_cursor_block();
    `));
    await database.close();
  });

  async function createTicket(message = 'Where is my Case?') {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    return new LocalTicketGateway(database.db).createTicket({
      requester: { name: 'Jordan Lee', email: 'Jordan.Lee@othram-demo.test' },
      subject: 'Case update',
      message
    });
  }

  it('reads chronological threads and excludes agent comments from requester updates', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await createTicket();
    await gateway.addPublicReply(ticket.id, { message: 'Public reply', idempotencyKey: 'reply-1' });
    await gateway.addInternalNote(ticket.id, { message: 'Internal note', idempotencyKey: 'note-1' });
    const requester = await gateway.addRequesterComment(ticket.id, {
      message: 'Requester follow-up',
      idempotencyKey: 'requester-1'
    });

    expect((await gateway.getTicket(ticket.id))?.comments.map((comment) => comment.body)).toEqual([
      'Where is my Case?',
      'Public reply',
      'Internal note',
      'Requester follow-up'
    ]);
    expect((await gateway.listRequesterUpdates()).updates.map((update) => update.comment.body)).toEqual([
      'Where is my Case?',
      'Requester follow-up'
    ]);
    expect(requester.comment).toMatchObject({ author: 'requester', isPublic: true });
  });

  it('returns a checkpoint on every page and preserves it after restart', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await createTicket('First');
    await gateway.addRequesterComment(ticket.id, { message: 'Second', idempotencyKey: 'second' });
    await gateway.addRequesterComment(ticket.id, { message: 'Third', idempotencyKey: 'third' });

    const firstPage = await gateway.listRequesterUpdates({ limit: 2 });
    expect(firstPage.updates.map((update) => update.comment.body)).toEqual(['First', 'Second']);
    expect(firstPage.nextCursor).toBe(firstPage.updates[1]!.cursor);

    const restarted = new LocalTicketGateway(database.db);
    const finalPage = await restarted.listRequesterUpdates({ cursor: firstPage.nextCursor!, limit: 2 });
    expect(finalPage.updates.map((update) => update.comment.body)).toEqual(['Third']);
    expect(finalPage.nextCursor).toBe(finalPage.updates[0]!.cursor);
    expect(await restarted.listRequesterUpdates({ cursor: finalPage.nextCursor! })).toEqual({
      updates: [],
      nextCursor: finalPage.nextCursor
    });
  });

  it('serializes cursor assignment through commit under concurrent intake', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const firstTicket = await createTicket('First initial');
    const secondTicket = await createTicket('Second initial');
    const checkpoint = (await gateway.listRequesterUpdates()).nextCursor!;
    const blockerReady = deferred();
    const releaseBlocker = deferred();
    const blocker = database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(99123, 1)`);
      blockerReady.resolve();
      await releaseBlocker.promise;
    });
    await blockerReady.promise;

    const first = gateway.addRequesterComment(firstTicket.id, {
      message: '__cursor_first__',
      idempotencyKey: 'cursor-first'
    });
    await waitForBlockedCursorInsert();
    let secondSettled = false;
    const second = new LocalTicketGateway(database.db)
      .addRequesterComment(secondTicket.id, { message: 'Cursor second', idempotencyKey: 'cursor-second' })
      .finally(() => {
        secondSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const secondSettledWhileFirstWasUncommitted = secondSettled;
    const updatesWhileFirstWasUncommitted = await gateway.listRequesterUpdates({ cursor: checkpoint });
    releaseBlocker.resolve();
    await blocker;
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondSettledWhileFirstWasUncommitted).toBe(false);
    expect(updatesWhileFirstWasUncommitted).toEqual({ updates: [], nextCursor: checkpoint });
    expect(BigInt(firstResult.cursor)).toBeLessThan(BigInt(secondResult.cursor));
    expect((await gateway.listRequesterUpdates({ cursor: checkpoint })).updates.map((update) => update.comment.body))
      .toEqual(['__cursor_first__', 'Cursor second']);
  });

  it('replays complete requester snapshots and rejects conflicting reuse', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await createTicket();
    const original = await gateway.addRequesterComment(ticket.id, {
      message: 'Please check again.',
      idempotencyKey: 'requester-retry'
    });
    await gateway.updateTicket(ticket.id, {
      addTags: ['LATER-TAG'],
      status: 'solved',
      idempotencyKey: 'later-mutation'
    });

    expect(await gateway.addRequesterComment(ticket.id, {
      message: 'Please check again.',
      idempotencyKey: 'requester-retry'
    })).toEqual(original);
    expect((await gateway.getTicket(ticket.id))?.status).toBe('solved');
    expect(original.ticket.status).toBe('open');
    await expect(gateway.addRequesterComment(ticket.id, {
      message: 'Different message',
      idempotencyKey: 'requester-retry'
    })).rejects.toBeInstanceOf(TicketGatewayIdempotencyConflictError);
  });

  it('preserves concurrent ticket mutations and normalizes tags', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await createTicket();
    await Promise.all([
      gateway.updateTicket(ticket.id, {
        addTags: ['AI-Handled'],
        team: 'General Support',
        idempotencyKey: 'routing-team'
      }),
      new LocalTicketGateway(database.db).updateTicket(ticket.id, {
        addTags: ['Case-Status', 'ai-handled'],
        status: 'solved',
        idempotencyKey: 'routing-status'
      })
    ]);

    const updated = await gateway.getTicket(ticket.id);
    expect(updated).toMatchObject({
      team: 'General Support',
      status: 'solved'
    });
    expect(updated?.tags).toHaveLength(2);
    expect(updated?.tags).toEqual(expect.arrayContaining(['ai-handled', 'case-status']));
  });

  it('rejects invalid runtime team and status values', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const gateway = new LocalTicketGateway(database.db);
    const ticket = await createTicket();

    await expect(gateway.updateTicket(ticket.id, {
      team: 'Tier 4',
      idempotencyKey: 'invalid-team'
    } as never)).rejects.toThrow('team must be Technical Team, Billing, General Support, or null.');
    await expect(gateway.updateTicket(ticket.id, {
      status: 'closed',
      idempotencyKey: 'invalid-status'
    } as never)).rejects.toThrow('status must be open, pending, or solved.');
  });
});
