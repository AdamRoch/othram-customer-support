import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { escalationReasons, type EscalationReason } from '@othram/shared';
import type { AgentCore, AgentMessage } from '../../agent-core/core.js';
import type { createDatabase } from '../../db/client.js';
import { ticketIngestionCursors, ticketWorkItems } from '../../db/schema.js';
import type { TicketEscalationContextMessage, TicketGateway, TicketTeam, TicketThread } from './gateway.js';

type Database = ReturnType<typeof createDatabase>['db'];
const RETRY_QUEUE_PENALTY = 100;

export type TicketWorkStatus =
  | 'PENDING'
  | 'LEASED'
  | 'READY_TO_SEND'
  | 'REPLIED'
  | 'ESCALATION_PENDING'
  | 'ESCALATED';

export interface TicketWorkEscalation {
  inboundCommentId: string;
  turnId: string;
  reason: EscalationReason;
  summary: string;
  team: TicketTeam;
  context: TicketEscalationContextMessage[];
}

interface LegacyTicketWorkEscalation {
  reason: EscalationReason;
  summary: string;
  team: TicketTeam;
}

export interface TicketWorkerItem {
  id: string;
  ticketId: string;
  inboundCommentId: string;
  inboundCursor: string;
  queueOrder: bigint;
  status: TicketWorkStatus;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  attempts: number;
  replyText: string | null;
  replyIdempotencyKey: string;
  escalation: TicketWorkEscalation | LegacyTicketWorkEscalation | null;
}

export interface TicketPollingWorkerOptions {
  database: Database;
  gateway: TicketGateway;
  /** Constructed per work attempt so no process-local conversation is trusted. */
  createAgentCore(input: { requesterEmail: string }): AgentCore;
  cursorName?: string;
  pageSize?: number;
  leaseMs?: number;
  now?: () => Date;
  createId?: () => string;
  /** Test-only crash seam: runs after the durable gateway write, before REPLIED. */
  afterGatewayReply?: () => Promise<void> | void;
  /** Test-only pause seam: runs after READY_TO_SEND is durable, before delivery. */
  beforeGatewayReply?: () => Promise<void> | void;
  /** Test-only crash seam: runs after atomic escalation execution, before terminal state. */
  afterGatewayEscalation?: () => Promise<void> | void;
}

export interface TicketPollingLoop {
  stop(): Promise<void>;
}

function asWorkItem(row: Record<string, unknown>): TicketWorkerItem {
  if (typeof row.status !== 'string' || !['PENDING', 'LEASED', 'READY_TO_SEND', 'REPLIED', 'ESCALATION_PENDING', 'ESCALATED'].includes(row.status)) {
    throw new Error(`Unsupported ticket work state ${row.status}.`);
  }
  if (typeof row.id !== 'string' || typeof row.ticketId !== 'string' || typeof row.inboundCommentId !== 'string' ||
    typeof row.inboundCursor !== 'string' || typeof row.attempts !== 'number' ||
    typeof row.replyIdempotencyKey !== 'string') {
    throw new Error('Claimed ticket work item had invalid persisted fields.');
  }
  return {
    id: row.id,
    ticketId: row.ticketId,
    inboundCommentId: row.inboundCommentId,
    inboundCursor: row.inboundCursor,
    queueOrder: BigInt(row.queueOrder as string | number | bigint),
    status: row.status as TicketWorkStatus,
    leaseToken: typeof row.leaseToken === 'string' ? row.leaseToken : null,
    leaseExpiresAt: row.leaseExpiresAt instanceof Date ? row.leaseExpiresAt : null,
    attempts: row.attempts,
    replyText: typeof row.replyText === 'string' ? row.replyText : null,
    replyIdempotencyKey: row.replyIdempotencyKey,
    escalation: parseEscalation(row.escalation)
  };
}

function parseEscalation(value: unknown): TicketWorkEscalation | LegacyTicketWorkEscalation | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Persisted escalation must be an object.');
  const { inboundCommentId, turnId, reason, summary, team, context } = value as Record<string, unknown>;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('Persisted escalation has invalid summary.');
  if (typeof reason !== 'string' || !escalationReasons.includes(reason as EscalationReason)) {
    throw new Error('Persisted escalation has an unsupported reason.');
  }
  if (team !== 'Technical Team' && team !== 'Billing' && team !== 'General Support') {
    throw new Error('Persisted escalation has an unsupported team.');
  }
  const legacy = inboundCommentId === undefined && turnId === undefined && context === undefined;
  if (legacy) return { reason: reason as EscalationReason, summary, team };
  if (
    typeof inboundCommentId !== 'string' || !inboundCommentId.trim() ||
    typeof turnId !== 'string' || !turnId.trim()
  ) {
    throw new Error('Persisted escalation has invalid turn details.');
  }
  if (!Array.isArray(context) || context.some((message) => {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return true;
    const item = message as Record<string, unknown>;
    return typeof item.commentId !== 'string' || typeof item.body !== 'string' || typeof item.createdAt !== 'string' ||
      (item.author !== 'requester' && item.author !== 'agent');
  })) {
    throw new Error('Persisted escalation has invalid conversation context.');
  }
  return {
    inboundCommentId,
    turnId,
    reason: reason as EscalationReason,
    summary,
    team,
    context: context as TicketEscalationContextMessage[]
  };
}

function threadBeforeInbound(ticket: TicketThread, inboundCommentId: string): AgentMessage[] {
  const inboundIndex = ticket.comments.findIndex((comment) => comment.id === inboundCommentId);
  if (inboundIndex < 0) throw new Error(`Inbound comment ${inboundCommentId} is not in ticket ${ticket.id}.`);
  return ticket.comments.slice(0, inboundIndex).flatMap((comment) => {
    if (!comment.isPublic) return [];
    return [{ role: comment.author === 'requester' ? 'user' as const : 'assistant' as const, content: comment.body }];
  });
}

function escalationContext(ticket: TicketThread, inboundCommentId: string): TicketEscalationContextMessage[] {
  const inboundIndex = ticket.comments.findIndex((comment) => comment.id === inboundCommentId);
  if (inboundIndex < 0) throw new Error(`Inbound comment ${inboundCommentId} is not in ticket ${ticket.id}.`);
  return ticket.comments.slice(0, inboundIndex + 1).flatMap((comment) => {
    if (!comment.isPublic) return [];
    return [{
      commentId: comment.id,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt
    }];
  });
}

export class TicketPollingWorker {
  private readonly cursorName: string;
  private readonly pageSize: number;
  private readonly leaseMs: number;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private pollingLoopRunning = false;

  constructor(private readonly options: TicketPollingWorkerOptions) {
    this.cursorName = options.cursorName ?? 'local-ticket-requester-updates';
    this.pageSize = options.pageSize ?? 50;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  /** Poll once. Gateway IO happens before the short database transaction. */
  async pollOnce(): Promise<{ enqueued: number; cursor: string | null }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [checkpoint] = await this.options.database
        .select()
        .from(ticketIngestionCursors)
        .where(eq(ticketIngestionCursors.name, this.cursorName));
      const checkpointCursor = checkpoint?.cursor ?? null;
      const page = await this.options.gateway.listRequesterUpdates({
        cursor: checkpointCursor ?? undefined,
        limit: this.pageSize
      });
      if (page.updates.length > 0 && page.nextCursor === null) {
        throw new Error('TicketGateway returned updates without a durable nextCursor checkpoint.');
      }
      const now = this.now();
      let enqueued = 0;
      let stale = false;

      await this.options.database.transaction(async (tx) => {
      await tx.insert(ticketIngestionCursors).values({ name: this.cursorName }).onConflictDoNothing();
      const [locked] = await tx
        .select()
        .from(ticketIngestionCursors)
        .where(eq(ticketIngestionCursors.name, this.cursorName))
        .for('update');
      if (!locked) throw new Error(`Could not lock ticket ingestion cursor ${this.cursorName}.`);
      // Provider cursor tokens are opaque.  A stale fetch cannot be ordered or
      // merged safely, so retry from the durable checkpoint instead.
      if (locked.cursor !== checkpointCursor) {
        stale = true;
        return;
      }
      for (const update of page.updates) {
        const inserted = await tx
          .insert(ticketWorkItems)
          .values({
            ticketId: update.ticket.id,
            inboundCommentId: update.comment.id,
            inboundCursor: update.cursor,
            replyIdempotencyKey: `ticket:${update.ticket.id}:inbound:${update.comment.id}:public-reply`
          })
          .onConflictDoNothing()
          .returning({ id: ticketWorkItems.id });
        enqueued += inserted.length;
      }
      await tx
        .update(ticketIngestionCursors)
        .set({ cursor: page.nextCursor ?? checkpointCursor, updatedAt: now })
        .where(eq(ticketIngestionCursors.name, this.cursorName));
      });
      if (!stale) return { enqueued, cursor: page.nextCursor ?? checkpointCursor };
    }
    throw new Error(`Ticket ingestion cursor ${this.cursorName} changed repeatedly; retry pollOnce.`);
  }

  async processOne(): Promise<TicketWorkStatus | null> {
    const item = await this.claimOne();
    if (!item) return null;
    return this.processClaimedItem(item);
  }

  private async processClaimedItem(item: TicketWorkerItem): Promise<TicketWorkStatus> {
    if (item.escalation) {
      const escalation = 'turnId' in item.escalation
        ? item.escalation
        : await this.hydrateLegacyEscalation(item, item.escalation);
      return this.executeEscalation(item, escalation);
    }

    const ticket = await this.options.gateway.getTicket(item.ticketId);
    if (!ticket) throw new Error(`Ticket ${item.ticketId} disappeared before processing.`);

    let reply = item.replyText;
    if (!reply) {
      const core = this.options.createAgentCore({ requesterEmail: ticket.requester.email });
      const inbound = ticket.comments.find((comment) => comment.id === item.inboundCommentId);
      if (!inbound || inbound.author !== 'requester' || !inbound.isPublic) {
        throw new Error(`Work item ${item.id} does not reference a public requester update.`);
      }
      const result = await core.runTurnFromHistory(
        inbound.body,
        item.ticketId,
        threadBeforeInbound(ticket, item.inboundCommentId)
      );
      const escalation = result.events.find((event) => event.type === 'escalated');
      if (escalation) {
        await this.markEscalationPending(item, ticket, escalation);
        return 'ESCALATION_PENDING';
      }
      if (!result.reply) throw new Error(`Agent Core returned neither a reply nor escalation for ${item.id}.`);
      reply = result.reply;
      await this.persistReply(item, reply);
    }

    await this.options.beforeGatewayReply?.();
    await this.options.gateway.addPublicReply(item.ticketId, {
      message: reply,
      idempotencyKey: item.replyIdempotencyKey
    });
    await this.options.afterGatewayReply?.();
    await this.options.gateway.updateTicket(item.ticketId, {
      status: 'solved',
      idempotencyKey: `${item.replyIdempotencyKey}:solve`
    });
    await this.markReplied(item);
    return 'REPLIED';
  }

  private async executeEscalation(
    item: TicketWorkerItem,
    escalation: TicketWorkEscalation
  ): Promise<TicketWorkStatus> {
    await this.options.gateway.applyEscalation(item.ticketId, {
      ...escalation,
      idempotencyKey: `ticket:${item.ticketId}:turn:${escalation.turnId}:escalation`
    });
    await this.options.afterGatewayEscalation?.();
    await this.markEscalated(item);
    return 'ESCALATED';
  }

  private async hydrateLegacyEscalation(
    item: TicketWorkerItem,
    legacy: LegacyTicketWorkEscalation
  ): Promise<TicketWorkEscalation> {
    const ticket = await this.options.gateway.getTicket(item.ticketId);
    if (!ticket) throw new Error(`Ticket ${item.ticketId} disappeared before escalation recovery.`);
    const inbound = ticket.comments.find((comment) => comment.id === item.inboundCommentId);
    if (!inbound || inbound.author !== 'requester' || !inbound.isPublic) {
      throw new Error(`Work item ${item.id} does not reference a public requester update.`);
    }
    const escalation = {
      ...legacy,
      inboundCommentId: item.inboundCommentId,
      turnId: `legacy-${item.id}`,
      context: escalationContext(ticket, item.inboundCommentId)
    };
    const leaseToken = this.requireLease(item);
    const changed = await this.options.database
      .update(ticketWorkItems)
      .set({ escalation, updatedAt: this.now() })
      .where(and(eq(ticketWorkItems.id, item.id), eq(ticketWorkItems.leaseToken, leaseToken)))
      .returning({ id: ticketWorkItems.id });
    if (changed.length !== 1) throw new Error(`Lost lease while recovering escalation for ${item.id}.`);
    return escalation;
  }

  /** One durable poll plus bounded processing; safe to call after restart. */
  async drain(input: { maxItems?: number } = {}): Promise<{ enqueued: number; processed: number }> {
    const maxItems = input.maxItems ?? 100;
    const polled = await this.pollOnce();
    const failures: unknown[] = [];
    let attempted = 0;
    let processed = 0;
    while (attempted < maxItems) {
      const item = await this.claimOne();
      if (!item) break;
      attempted += 1;
      try {
        await this.processClaimedItem(item);
        processed += 1;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Multiple ticket work items failed.');
    return { enqueued: polled.enqueued, processed };
  }

  /**
   * Starts a non-overlapping polling loop. The returned stop operation waits
   * for an active drain before callers close the database connection.
   */
  start(input: {
    intervalMs?: number;
    onError?: (error: unknown) => void;
  } = {}): TicketPollingLoop {
    if (this.pollingLoopRunning) throw new Error('Ticket polling loop is already running.');
    const intervalMs = input.intervalMs ?? 30_000;
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      throw new Error('Ticket polling interval must be a positive integer.');
    }

    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let active: Promise<void> | undefined;
    let stopPromise: Promise<void> | undefined;

    const run = () => {
      active = this.drain()
        .then(() => undefined)
        .catch((error: unknown) => {
          input.onError?.(error);
        })
        .finally(() => {
          active = undefined;
          if (!stopped) timer = setTimeout(run, intervalMs);
        });
    };

    this.pollingLoopRunning = true;
    run();
    return {
      stop: () => {
        if (!stopPromise) {
          stopped = true;
          if (timer) clearTimeout(timer);
          stopPromise = (async () => {
            try {
              await active;
            } finally {
              this.pollingLoopRunning = false;
            }
          })();
        }
        return stopPromise;
      }
    };
  }

  private async claimOne(): Promise<TicketWorkerItem | null> {
    const leaseToken = this.createId();
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const result = await this.options.database.execute(sql`
      WITH candidate AS (
        SELECT id FROM ticket_work_items
        WHERE (status IN ('PENDING', 'ESCALATION_PENDING')
          OR (status IN ('LEASED', 'READY_TO_SEND') AND lease_expires_at < ${now}))
          AND NOT EXISTS (
            SELECT 1 FROM ticket_work_items AS earlier
            WHERE earlier.ticket_id = ticket_work_items.ticket_id
              AND earlier.id <> ticket_work_items.id
              AND earlier.queue_order < ticket_work_items.queue_order
              AND earlier.status IN ('PENDING', 'LEASED', 'READY_TO_SEND', 'ESCALATION_PENDING')
          )
        -- A retry yields a bounded number of queue slots. This prevents both a
        -- poison item from monopolizing the head and fresh traffic from
        -- starving a transient failure forever.
        ORDER BY queue_order + attempts::bigint * ${RETRY_QUEUE_PENALTY}::bigint, queue_order
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ticket_work_items AS item
      SET status = 'LEASED', lease_token = ${leaseToken}::uuid,
          lease_expires_at = ${leaseExpiresAt}, attempts = item.attempts + 1, updated_at = ${now}
      FROM candidate
      WHERE item.id = candidate.id
      RETURNING item.id AS "id", item.ticket_id AS "ticketId",
        item.inbound_comment_id AS "inboundCommentId", item.inbound_cursor AS "inboundCursor",
        item.queue_order AS "queueOrder", item.status AS "status", item.lease_token AS "leaseToken",
        item.lease_expires_at AS "leaseExpiresAt", item.attempts AS "attempts",
        item.reply_text AS "replyText", item.reply_idempotency_key AS "replyIdempotencyKey",
        item.escalation AS "escalation"
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? asWorkItem(row) : null;
  }

  private async persistReply(item: TicketWorkerItem, reply: string): Promise<void> {
    const leaseToken = this.requireLease(item);
    const changed = await this.options.database
      .update(ticketWorkItems)
      .set({ status: 'READY_TO_SEND', replyText: reply, updatedAt: this.now() })
      .where(and(eq(ticketWorkItems.id, item.id), eq(ticketWorkItems.leaseToken, leaseToken)))
      .returning({ id: ticketWorkItems.id });
    if (changed.length !== 1) throw new Error(`Lost lease while persisting reply for ${item.id}.`);
  }

  private async markReplied(item: TicketWorkerItem): Promise<void> {
    const leaseToken = this.requireLease(item);
    const changed = await this.options.database
      .update(ticketWorkItems)
      .set({ status: 'REPLIED', leaseToken: null, leaseExpiresAt: null, updatedAt: this.now() })
      .where(and(eq(ticketWorkItems.id, item.id), eq(ticketWorkItems.leaseToken, leaseToken)))
      .returning({ id: ticketWorkItems.id });
    if (changed.length !== 1) throw new Error(`Lost lease while recording delivery for ${item.id}.`);
  }

  private async markEscalated(item: TicketWorkerItem): Promise<void> {
    const leaseToken = this.requireLease(item);
    const changed = await this.options.database
      .update(ticketWorkItems)
      .set({ status: 'ESCALATED', leaseToken: null, leaseExpiresAt: null, updatedAt: this.now() })
      .where(and(eq(ticketWorkItems.id, item.id), eq(ticketWorkItems.leaseToken, leaseToken)))
      .returning({ id: ticketWorkItems.id });
    if (changed.length !== 1) throw new Error(`Lost lease while recording escalation for ${item.id}.`);
  }

  private async markEscalationPending(
    item: TicketWorkerItem,
    ticket: TicketThread,
    event: Extract<Awaited<ReturnType<AgentCore['runTurn']>>['events'][number], { type: 'escalated' }>
  ): Promise<void> {
    const leaseToken = this.requireLease(item);
    const changed = await this.options.database
      .update(ticketWorkItems)
      .set({
        status: 'ESCALATION_PENDING',
        escalation: {
          inboundCommentId: item.inboundCommentId,
          turnId: event.turnId,
          reason: event.reason,
          summary: event.summary,
          team: event.team,
          context: escalationContext(ticket, item.inboundCommentId)
        },
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: this.now()
      })
      .where(and(eq(ticketWorkItems.id, item.id), eq(ticketWorkItems.leaseToken, leaseToken)))
      .returning({ id: ticketWorkItems.id });
    if (changed.length !== 1) throw new Error(`Lost lease while parking escalation for ${item.id}.`);
  }

  private requireLease(item: TicketWorkerItem): string {
    if (!item.leaseToken) throw new Error(`Work item ${item.id} has no lease token.`);
    return item.leaseToken;
  }
}
