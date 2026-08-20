export interface HealthResponse {
  status: 'ok';
  service: 'othram-support-server';
}

export const stages = [
  'RECEIVED',
  'EXTRACTION',
  'QUANTIFICATION',
  'LIBRARY_PREP',
  'SEQUENCING',
  'BIOINFORMATICS',
  'REVIEW',
  'DELIVERED'
] as const;

export type Stage = (typeof stages)[number];

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface Case {
  id: string;
  caseNumber: string;
  customerId: string;
  serviceType: string;
  currentStage: Stage;
  stageEnteredAt: Date;
  submittedAt: Date;
  delayed: boolean;
  notes: string | null;
}

export type TimelineStatus = 'ON_SCHEDULE' | 'PAST_STANDARD_DURATION' | 'DELAYED' | 'DELIVERED';

export interface TimelineMilestone {
  at: string;
  daysFromNow: number;
  weeksFromNow: number;
}

export type TimelineEta =
  | {
      status: 'AVAILABLE';
      sequencing: TimelineMilestone | null;
      delivery: TimelineMilestone;
      standardTotalDays: number;
      standardTotalWeeks: number;
    }
  | {
      status: 'UNAVAILABLE';
      reason: 'CASE_DELAYED';
      standardTotalDays: number;
      standardTotalWeeks: number;
    }
  | {
      status: 'COMPLETE';
      deliveredAt: string;
      standardTotalDays: number;
      standardTotalWeeks: number;
    };

export interface CaseTimelineResponse {
  caseNumber: string;
  currentStage: Stage;
  stageEnteredAt: string;
  timeInStageDays: number;
  standardStageDurationDays: number;
  pastStandardDuration: boolean;
  delayed: boolean;
  timelineStatus: TimelineStatus;
  eta: TimelineEta;
}

export interface CaseTimelineNotFoundResponse {
  error: 'CASE_NOT_FOUND';
  caseNumber: string;
}

export interface KnowledgeSearchCitation {
  document: string;
  section: string;
  category: string;
  sourcePath: string;
}

export interface KnowledgeSearchResult {
  content: string;
  citation: KnowledgeSearchCitation;
  similarity: number;
}

export interface KnowledgeSearchResponse {
  query: string;
  results: KnowledgeSearchResult[];
}

export interface KnowledgeSearchBadRequestResponse {
  error: 'INVALID_KNOWLEDGE_SEARCH_QUERY';
  message: string;
}

export const escalationReasons = [
  'COMPLEX_ISSUE',
  'OUTSIDE_STANDARD_PROCEDURES',
  'CUSTOMER_FRUSTRATED',
  'BILLING_DISPUTE',
  'TECHNICAL_PROBLEM',
  'CUSTOMER_REQUESTS_HUMAN',
  'LOW_CONFIDENCE'
] as const;

export type EscalationReason = (typeof escalationReasons)[number];

export const customerEmotionalStates = [
  'NEUTRAL',
  'CALM',
  'FRUSTRATED',
  'ANGRY',
  'ANXIOUS',
  'SAD',
  'HUMOROUS'
] as const;

export type CustomerEmotionalState = (typeof customerEmotionalStates)[number];

export type EscalationTeam = 'Technical Team' | 'Billing' | 'General Support';

export type AgentEvent =
  | {
      type: 'turn_started';
      conversationId: string;
      turnId: string;
      sequence: number;
      message: string;
    }
  | {
      type: 'tool_called';
      conversationId: string;
      turnId: string;
      sequence: number;
      callId: string;
      toolName: string;
      arguments: unknown;
    }
  | {
      type: 'tool_completed';
      conversationId: string;
      turnId: string;
      sequence: number;
      callId: string;
      toolName: string;
      result: unknown;
    }
  | {
      type: 'reply_created';
      conversationId: string;
      turnId: string;
      sequence: number;
      message: string;
      knowledgeGroundingDecision: 'REQUIRED' | 'NOT_APPLICABLE';
    }
  | {
      type: 'confidence_recorded';
      conversationId: string;
      turnId: string;
      sequence: number;
      confidence: number;
    }
  | {
      type: 'customer_emotion_recorded';
      conversationId: string;
      turnId: string;
      sequence: number;
      emotionalState: CustomerEmotionalState;
    }
  | {
      type: 'escalated';
      conversationId: string;
      turnId: string;
      sequence: number;
      reason: EscalationReason;
      summary: string;
      team: EscalationTeam;
    };

export interface ChatRequest {
  conversationId?: string;
  message: string;
}

export interface ChatResponse {
  conversationId: string;
  reply: string | null;
  events: AgentEvent[];
}

export interface ChatErrorResponse {
  error: 'INVALID_CHAT_REQUEST' | 'CONVERSATION_NOT_FOUND';
  message: string;
}
