import { createHash } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { escalationReasons } from '@othram/shared';
import type { createDatabase } from '../../db/client.js';
import {
  localTicketComments,
  localTicketIdempotency,
  localTicketRequesters,
  localTickets
} from '../../db/schema.js';
import {
  type TicketComment,
  type TicketEscalation,
  type TicketEscalationContextMessage,
  type TicketEscalationResult,
  type TicketGateway,
  TicketGatewayIdempotencyConflictError,
  type TicketStatus,
  type TicketTeam,
  type TicketThread
} from './gateway.js';

type Database = ReturnType<typeof createDatabase>['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  team: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
};

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty.`);
  return trimmed;
}

function requireStatus(value: unknown): TicketStatus | undefined {
  if (value === undefined) return undefined;
  if (value !== 'open' && value !== 'pending' && value !== 'solved') {
    throw new Error('status must be open, pending, or solved.');
  }
  return value;
}

function requireTeam(value: unknown): TicketTeam | null | undefined {
  if (value === undefined || value === null) return value;
  if (value !== 'Technical Team' && value !== 'Billing' && value !== 'General Support') {
    throw new Error('team must be Technical Team, Billing, General Support, or null.');
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function toTicketComment(row: {
  id: string;
  author: string;
  isPublic: boolean;
  body: string;
  createdAt: Date;
}): TicketComment {
  if (row.author !== 'requester' && row.author !== 'agent') {
    throw new Error(`Unsupported local ticket comment author: ${row.author}`);
  }
  return {
    id: row.id,
    author: row.author,
    isPublic: row.isPublic,
    body: row.body,
    createdAt: row.createdAt.toISOString()
  };
}

function toTicketThread(ticket: TicketRow, comments: TicketComment[]): TicketThread {
  const status = requireStatus(ticket.status);
  const team = requireTeam(ticket.team);
  if (!status || team === undefined) throw new Error('Stored local ticket fields are invalid.');
  return {
    id: ticket.id,
    subject: ticket.subject,
    requester: {
      id: ticket.requesterId,
      name: ticket.requesterName,
      email: ticket.requesterEmail
    },
    status,
    team,
    tags: ticket.tags,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    comments
  };
}

function ticketSelection() {
  return {
    id: localTickets.id,
    subject: localTickets.subject,
    status: localTickets.status,
    team: localTickets.team,
    tags: localTickets.tags,
    createdAt: localTickets.createdAt,
    updatedAt: localTickets.updatedAt,
    requesterId: localTicketRequesters.id,
    requesterName: localTicketRequesters.name,
    requesterEmail: localTicketRequesters.email
  };
}

export class LocalTicketGateway implements TicketGateway {
  constructor(private readonly database: Database) {}

  async listRequesterUpdates(input: { cursor?: string; limit?: number } = {}) {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer from 1 to 100.');
    }
    const cursor = input.cursor === undefined ? undefined : BigInt(input.cursor);
    if (cursor !== undefined && cursor < 0n) throw new Error('cursor must not be negative.');

    const conditions = [
      eq(localTicketComments.author, 'requester'),
      eq(localTicketComments.isPublic, true)
    ];
    if (cursor !== undefined) conditions.push(gt(localTicketComments.ingestSequence, cursor));

    const rows = await this.database
      .select({
        ingestSequence: localTicketComments.ingestSequence,
        commentId: localTicketComments.id,
        commentAuthor: localTicketComments.author,
        commentIsPublic: localTicketComments.isPublic,
        commentBody: localTicketComments.body,
        commentCreatedAt: localTicketComments.createdAt,
        ...ticketSelection()
      })
      .from(localTicketComments)
      .innerJoin(localTickets, eq(localTicketComments.ticketId, localTickets.id))
      .innerJoin(localTicketRequesters, eq(localTickets.requesterId, localTicketRequesters.id))
      .where(and(...conditions))
      .orderBy(asc(localTicketComments.ingestSequence))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const updates = await Promise.all(
      page.map(async (row) => ({
        cursor: row.ingestSequence.toString(),
        ticket: await this.ticketFromRow(row),
        comment: toTicketComment({
          id: row.commentId,
          author: row.commentAuthor,
          isPublic: row.commentIsPublic,
          body: row.commentBody,
          createdAt: row.commentCreatedAt
        })
      }))
    );
    const nextCursor = page.at(-1)?.ingestSequence.toString() ?? input.cursor ?? null;
    return { updates, nextCursor };
  }

  async getTicket(ticketId: string): Promise<TicketThread | null> {
    const [ticket] = await this.database
      .select(ticketSelection())
      .from(localTickets)
      .innerJoin(localTicketRequesters, eq(localTickets.requesterId, localTicketRequesters.id))
      .where(eq(localTickets.id, ticketId));
    return ticket ? this.ticketFromRow(ticket) : null;
  }

  async createTicket(input: { requester: { name: string; email: string }; subject: string; message: string }) {
    const name = requireText(input.requester.name, 'requester name');
    const email = requireText(input.requester.email, 'requester email').toLowerCase();
    const subject = requireText(input.subject, 'subject');
    const message = requireText(input.message, 'message');

    return this.database.transaction(async (tx) => {
      const [requester] = await tx
        .insert(localTicketRequesters)
        .values({ name, email })
        .onConflictDoUpdate({
          target: localTicketRequesters.email,
          set: { name, updatedAt: new Date() }
        })
        .returning();
      if (!requester) throw new Error('Could not create local ticket requester.');

      const [ticket] = await tx
        .insert(localTickets)
        .values({ requesterId: requester.id, subject })
        .returning();
      if (!ticket) throw new Error('Could not create local ticket.');
      await this.lockCommentSequence(tx);
      await tx.insert(localTicketComments).values({
        ticketId: ticket.id,
        author: 'requester',
        isPublic: true,
        body: message
      });
      const result = await this.ticketFromRow({
        ...ticket,
        requesterId: requester.id,
        requesterName: requester.name,
        requesterEmail: requester.email
      }, tx);
      return result;
    });
  }

  async addRequesterComment(ticketId: string, input: { message: string; idempotencyKey: string }) {
    const message = requireText(input.message, 'message');
    return this.idempotent(ticketId, input.idempotencyKey, { operation: 'requester_comment', message }, async (tx) => {
      await this.lockCommentSequence(tx);
      const [created] = await tx
        .insert(localTicketComments)
        .values({ ticketId, author: 'requester', isPublic: true, body: message })
        .returning();
      if (!created) throw new Error('Could not create local requester comment.');
      const [ticket] = await tx
        .update(localTickets)
        .set({ updatedAt: new Date() })
        .where(eq(localTickets.id, ticketId))
        .returning();
      if (!ticket) throw new Error(`Local ticket ${ticketId} was not found.`);
      const [requester] = await tx
        .select()
        .from(localTicketRequesters)
        .where(eq(localTicketRequesters.id, ticket.requesterId));
      if (!requester) throw new Error(`Requester for local ticket ${ticketId} was not found.`);
      return {
        cursor: created.ingestSequence.toString(),
        ticket: await this.ticketFromRow({
          ...ticket,
          requesterId: requester.id,
          requesterName: requester.name,
          requesterEmail: requester.email
        }, tx),
        comment: toTicketComment(created)
      };
    });
  }

  async addPublicReply(ticketId: string, input: { message: string; idempotencyKey: string }) {
    return this.addAgentComment(ticketId, input, true, 'public_reply');
  }

  async addInternalNote(ticketId: string, input: { message: string; idempotencyKey: string }) {
    return this.addAgentComment(ticketId, input, false, 'internal_note');
  }

  async updateTicket(
    ticketId: string,
    input: { addTags?: string[]; team?: TicketTeam | null; status?: TicketStatus; idempotencyKey: string }
  ) {
    const addTags = [...new Set((input.addTags ?? []).map((tag) => requireText(tag, 'tag').toLowerCase()))];
    const team = requireTeam(input.team);
    const status = requireStatus(input.status);
    return this.idempotent(ticketId, input.idempotencyKey, {
      operation: 'update_ticket',
      addTags,
      team,
      status
    }, async (tx) => {
      const [existing] = await tx.select().from(localTickets).where(eq(localTickets.id, ticketId));
      if (!existing) throw new Error(`Local ticket ${ticketId} was not found.`);
      const [updated] = await tx
        .update(localTickets)
        .set({
          tags: [...new Set([...existing.tags, ...addTags])],
          team: team === undefined ? existing.team : team,
          status: status ?? existing.status,
          updatedAt: new Date()
        })
        .where(eq(localTickets.id, ticketId))
        .returning();
      if (!updated) throw new Error(`Local ticket ${ticketId} was not found.`);
      return {
        id: updated.id,
        tags: updated.tags,
        team: requireTeam(updated.team)!,
        status: requireStatus(updated.status)!,
        updatedAt: updated.updatedAt.toISOString()
      };
    });
  }

  async applyEscalation(ticketId: string, input: TicketEscalation): Promise<TicketEscalationResult> {
    const inboundCommentId = requireText(input.inboundCommentId, 'escalation inbound comment id');
    const turnId = requireText(input.turnId, 'turn id');
    const summary = requireText(input.summary, 'escalation summary');
    const team = requireTeam(input.team);
    if (!team) throw new Error('escalation team is required.');
    const reason = requireText(input.reason, 'escalation reason');
    if (!escalationReasons.includes(reason as (typeof escalationReasons)[number])) {
      throw new Error('escalation reason is unsupported.');
    }
    const context = input.context.map((message) => ({
      commentId: requireText(message.commentId, 'escalation context comment id'),
      author: message.author,
      body: requireText(message.body, 'escalation context body'),
      createdAt: requireText(message.createdAt, 'escalation context created at')
    }));
    if (context.some((message) => message.author !== 'requester' && message.author !== 'agent')) {
      throw new Error('escalation context author must be requester or agent.');
    }
    const reasonTag = `ai-escalated:${reason.toLowerCase().replaceAll('_', '-')}`;
    const acknowledgmentMessage =
      "I'm sorry this needs specialist review. I've routed your request to the appropriate Othram team for review.";

    return this.idempotent(ticketId, input.idempotencyKey, {
      operation: 'apply_escalation', inboundCommentId, turnId, reason, summary, team, context
    }, async (tx) => {
      const [existing] = await tx.select().from(localTickets).where(eq(localTickets.id, ticketId));
      if (!existing) throw new Error(`Local ticket ${ticketId} was not found.`);

      const canonicalContext = await this.escalationContextForInbound(tx, ticketId, inboundCommentId);
      if (!sameEscalationContext(context, canonicalContext)) {
        throw new Error('Escalation context must match the durable public thread through its inbound comment.');
      }
      const internalNoteBody = JSON.stringify({
        type: 'ai_escalation',
        version: 1,
        inboundCommentId,
        turnId,
        reason,
        summary,
        team,
        conversation: canonicalContext
      });

      await this.lockCommentSequence(tx);
      const [internalNote] = await tx
        .insert(localTicketComments)
        .values({ ticketId, author: 'agent', isPublic: false, body: internalNoteBody })
        .returning();
      if (!internalNote) throw new Error('Could not create local escalation internal note.');

      const [updated] = await tx
        .update(localTickets)
        .set({
          tags: [...new Set([...existing.tags, 'ai-escalated', reasonTag])],
          team,
          status: 'open',
          updatedAt: new Date()
        })
        .where(eq(localTickets.id, ticketId))
        .returning();
      if (!updated) throw new Error(`Local ticket ${ticketId} was not found.`);

      const [acknowledgment] = await tx
        .insert(localTicketComments)
        .values({ ticketId, author: 'agent', isPublic: true, body: acknowledgmentMessage })
        .returning();
      if (!acknowledgment) throw new Error('Could not create local escalation acknowledgment.');

      return {
        internalNote: toTicketComment(internalNote),
        ticket: {
          id: updated.id,
          tags: updated.tags,
          team: requireTeam(updated.team)!,
          status: requireStatus(updated.status)!,
          updatedAt: updated.updatedAt.toISOString()
        },
        acknowledgment: toTicketComment(acknowledgment)
      };
    });
  }

  private async addAgentComment(
    ticketId: string,
    input: { message: string; idempotencyKey: string },
    isPublic: boolean,
    operation: 'public_reply' | 'internal_note'
  ) {
    const message = requireText(input.message, 'message');
    return this.idempotent(ticketId, input.idempotencyKey, { operation, message }, async (tx) => {
      await this.lockCommentSequence(tx);
      const [created] = await tx
        .insert(localTicketComments)
        .values({ ticketId, author: 'agent', isPublic, body: message })
        .returning();
      if (!created) throw new Error('Could not create local ticket comment.');
      await tx.update(localTickets).set({ updatedAt: new Date() }).where(eq(localTickets.id, ticketId));
      return toTicketComment(created);
    });
  }

  private async ticketFromRow(ticket: TicketRow, database: Database | Transaction = this.database): Promise<TicketThread> {
    const comments = await database
      .select()
      .from(localTicketComments)
      .where(eq(localTicketComments.ticketId, ticket.id))
      .orderBy(asc(localTicketComments.ingestSequence));
    return toTicketThread(ticket, comments.map(toTicketComment));
  }

  private async escalationContextForInbound(
    tx: Transaction,
    ticketId: string,
    inboundCommentId: string
  ): Promise<TicketEscalationContextMessage[]> {
    const comments = await tx
      .select()
      .from(localTicketComments)
      .where(eq(localTicketComments.ticketId, ticketId))
      .orderBy(asc(localTicketComments.ingestSequence));
    const inboundIndex = comments.findIndex((comment) => comment.id === inboundCommentId);
    const inbound = comments[inboundIndex];
    if (!inbound || inbound.author !== 'requester' || !inbound.isPublic) {
      throw new Error(`Escalation inbound comment ${inboundCommentId} is not a public requester update for ticket ${ticketId}.`);
    }
    return comments.slice(0, inboundIndex + 1).flatMap((comment) => {
      if (!comment.isPublic) return [];
      return [{
        commentId: comment.id,
        author: toTicketComment(comment).author,
        body: comment.body,
        createdAt: comment.createdAt.toISOString()
      }];
    });
  }

  private async idempotent<T>(
    ticketId: string,
    idempotencyKey: string,
    request: unknown,
    operation: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    const key = requireText(idempotencyKey, 'idempotency key');
    const hash = requestHash(request);
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('local-ticket-mutation'), hashtext(${ticketId}))`);
      const [existing] = await tx
        .select()
        .from(localTicketIdempotency)
        .where(and(eq(localTicketIdempotency.ticketId, ticketId), eq(localTicketIdempotency.key, key)));
      if (existing) {
        if (existing.requestHash !== hash) throw new TicketGatewayIdempotencyConflictError(ticketId, key);
        return existing.result as T;
      }
      const result = await operation(tx);
      await tx.insert(localTicketIdempotency).values({ ticketId, key, requestHash: hash, result });
      return result;
    });
  }

  private async lockCommentSequence(tx: Transaction): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('local-ticket-cursor'), 1)`);
  }
}

function sameEscalationContext(
  submitted: TicketEscalationContextMessage[],
  canonical: TicketEscalationContextMessage[]
): boolean {
  return submitted.length === canonical.length && submitted.every((message, index) => {
    const expected = canonical[index];
    return message.commentId === expected?.commentId &&
      message.author === expected.author &&
      message.body === expected.body &&
      message.createdAt === expected.createdAt;
  });
}
