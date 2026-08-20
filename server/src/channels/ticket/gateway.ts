export type TicketStatus = 'open' | 'pending' | 'solved';

export interface TicketRequester {
  id: string;
  name: string;
  email: string;
}

export interface TicketComment {
  id: string;
  author: 'requester' | 'agent';
  isPublic: boolean;
  body: string;
  createdAt: string;
}

export interface TicketThread {
  id: string;
  subject: string;
  requester: TicketRequester;
  status: TicketStatus;
  team: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  comments: TicketComment[];
}

export interface RequesterUpdate {
  cursor: string;
  ticket: TicketThread;
  comment: TicketComment;
}

export interface TicketActionOptions {
  idempotencyKey: string;
}

export interface TicketGateway {
  listRequesterUpdates(input?: { cursor?: string; limit?: number }): Promise<{
    updates: RequesterUpdate[];
    nextCursor: string | null;
  }>;
  getTicket(ticketId: string): Promise<TicketThread | null>;
  createTicket(input: {
    requester: { name: string; email: string };
    subject: string;
    message: string;
  }): Promise<TicketThread>;
  addRequesterComment(
    ticketId: string,
    input: { message: string } & TicketActionOptions
  ): Promise<RequesterUpdate>;
  addPublicReply(
    ticketId: string,
    input: { message: string } & TicketActionOptions
  ): Promise<TicketComment>;
  addInternalNote(
    ticketId: string,
    input: { message: string } & TicketActionOptions
  ): Promise<TicketComment>;
  updateTicket(
    ticketId: string,
    input: { addTags?: string[]; team?: string | null; status?: TicketStatus } & TicketActionOptions
  ): Promise<Pick<TicketThread, 'id' | 'tags' | 'team' | 'status' | 'updatedAt'>>;
}

export class TicketGatewayIdempotencyConflictError extends Error {
  constructor(ticketId: string, key: string) {
    super(`Idempotency key "${key}" was already used with different input for ticket ${ticketId}.`);
    this.name = 'TicketGatewayIdempotencyConflictError';
  }
}
