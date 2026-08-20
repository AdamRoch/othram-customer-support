import { randomUUID } from 'node:crypto';
import {
  customerEmotionalStates,
  escalationReasons,
  type AgentEvent,
  type ChatResponse,
  type CustomerEmotionalState,
  type EscalationReason,
  type EscalationTeam
} from '@othram/shared';
import { AGENT_SYSTEM_PROMPT } from './prompt.js';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export interface AgentToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface AgentToolOutput {
  callId: string;
  output: string;
}

export interface AgentModelRequest {
  instructions: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  previousResponseId?: string;
  toolOutputs?: AgentToolOutput[];
}

export interface AgentModelResponse {
  responseId: string;
  toolCalls: AgentToolCall[];
  outputText: string;
}

export interface AgentModel {
  generate(request: AgentModelRequest): Promise<AgentModelResponse>;
}

export interface AgentToolResult {
  output: unknown;
  reply?: string;
  replyRequirement?: ReplyRequirement;
}

export interface ReplyRequirement {
  citationOptions?: ReadonlyArray<string>;
  requiredMessage?: string;
}

export interface AgentTool {
  definition: AgentToolDefinition;
  execute(argumentsValue: unknown): Promise<AgentToolResult>;
}

export interface AgentCoreConfig {
  confidenceThreshold: number;
}

const DEFAULT_CONFIG: AgentCoreConfig = { confidenceThreshold: 0.7 };

interface ReplyArguments {
  message: string;
  confidence: number;
  emotionalState: CustomerEmotionalState;
}

interface EscalationArguments {
  reason: EscalationReason;
  summary: string;
  team: EscalationTeam;
  emotionalState: CustomerEmotionalState;
}

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} was not found.`);
  }
}

function parseArguments(call: AgentToolCall): unknown {
  try {
    return JSON.parse(call.arguments) as unknown;
  } catch {
    throw new Error(`Tool ${call.name} returned invalid JSON arguments.`);
  }
}

function isCustomerEmotionalState(value: unknown): value is CustomerEmotionalState {
  return typeof value === 'string' && customerEmotionalStates.includes(value as CustomerEmotionalState);
}

function parseReplyArguments(value: unknown): ReplyArguments {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The reply tool requires an object.');
  }
  const { message, confidence, emotionalState } = value as Record<string, unknown>;
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('The reply tool requires a non-empty message.');
  }
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('The reply tool requires a confidence from 0 to 1.');
  }
  if (!isCustomerEmotionalState(emotionalState)) {
    throw new Error('The reply tool requires a supported customer emotional state.');
  }
  return { message: message.trim(), confidence, emotionalState };
}

function parseEscalationArguments(value: unknown): EscalationArguments {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The escalate tool requires an object.');
  }
  const { reason, summary, team, emotionalState } = value as Record<string, unknown>;
  if (typeof reason !== 'string' || !escalationReasons.includes(reason as EscalationReason)) {
    throw new Error('The escalate tool requires a supported reason.');
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error('The escalate tool requires a non-empty summary.');
  }
  if (team !== 'Technical Team' && team !== 'Billing' && team !== 'General Support') {
    throw new Error('The escalate tool requires a supported team.');
  }
  if (!isCustomerEmotionalState(emotionalState)) {
    throw new Error('The escalate tool requires a supported customer emotional state.');
  }
  return { reason: reason as EscalationReason, summary: summary.trim(), team, emotionalState };
}

function createReplyTool(): AgentTool {
  return {
    definition: {
      type: 'function',
      name: 'reply',
      description: 'Send the final Customer-facing response for this turn.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', minLength: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          emotionalState: { type: 'string', enum: customerEmotionalStates }
        },
        required: ['message', 'confidence', 'emotionalState'],
        additionalProperties: false
      },
      strict: true
    },
    async execute(argumentsValue) {
      const { message } = parseReplyArguments(argumentsValue);
      return { output: { accepted: true }, reply: message };
    }
  };
}

function assertReplyMeetsRequirements(
  message: string,
  requirements: ReadonlyArray<ReplyRequirement>,
  requiresKnowledgeGrounding: boolean
): void {
  if (requiresKnowledgeGrounding && requirements.length === 0) {
    throw new Error('A Customer-facing reply requires a completed knowledge search.');
  }

  for (const requirement of requirements) {
    if (requirement.requiredMessage && message !== requirement.requiredMessage) {
      throw new Error('A knowledge search with no results requires the honest no-results response.');
    }

    if (
      requirement.citationOptions &&
      !requirement.citationOptions.some((citation) => message.includes(citation))
    ) {
      throw new Error('A knowledge-grounded reply must include a citation from the retrieved passages.');
    }
  }
}

function createEscalateTool(): AgentTool {
  return {
    definition: {
      type: 'function',
      name: 'escalate',
      description: 'Escalate a Customer request that requires human judgment.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: escalationReasons },
          summary: { type: 'string', minLength: 1 },
          team: { type: 'string', enum: ['Technical Team', 'Billing', 'General Support'] },
          emotionalState: { type: 'string', enum: customerEmotionalStates }
        },
        required: ['reason', 'summary', 'team', 'emotionalState'],
        additionalProperties: false
      },
      strict: true
    },
    async execute(argumentsValue) {
      parseEscalationArguments(argumentsValue);
      return { output: { recorded: true } };
    }
  };
}

export class AgentCore {
  private readonly conversations = new Map<string, AgentMessage[]>();
  private readonly conversationTails = new Map<string, Promise<void>>();
  private readonly tools: Map<string, AgentTool>;
  private readonly requiresKnowledgeGrounding: boolean;

  constructor(
    private readonly model: AgentModel,
    private readonly createId: () => string = randomUUID,
    tools: AgentTool[] = [],
    private readonly config: AgentCoreConfig = DEFAULT_CONFIG
  ) {
    if (
      !Number.isFinite(config.confidenceThreshold) ||
      config.confidenceThreshold < 0 ||
      config.confidenceThreshold > 1
    ) {
      throw new Error('confidenceThreshold must be a finite number from 0 to 1.');
    }
    this.tools = new Map(
      [createReplyTool(), createEscalateTool(), ...tools].map((tool) => [tool.definition.name, tool])
    );
    this.requiresKnowledgeGrounding = this.tools.has('search_knowledge');
  }

  async runTurn(message: string, conversationId?: string): Promise<ChatResponse> {
    const id = conversationId ?? this.createId();
    const previousTurn = this.conversationTails.get(id) ?? Promise.resolve();
    let releaseTurn = () => {};
    const currentTurn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const tail = previousTurn.catch(() => undefined).then(() => currentTurn);
    this.conversationTails.set(id, tail);

    await previousTurn.catch(() => undefined);
    try {
      return await this.runExclusiveTurn(message, id, conversationId !== undefined);
    } finally {
      releaseTurn();
      if (this.conversationTails.get(id) === tail) {
        this.conversationTails.delete(id);
      }
    }
  }

  private async runExclusiveTurn(
    message: string,
    id: string,
    existingConversation: boolean
  ): Promise<ChatResponse> {
    const existingMessages = existingConversation ? this.conversations.get(id) : [];
    if (!existingMessages) {
      throw new ConversationNotFoundError(id);
    }

    const turnId = this.createId();
    const messages = [...existingMessages, { role: 'user' as const, content: message }];
    const events: AgentEvent[] = [
      { type: 'turn_started', conversationId: id, turnId, sequence: 0, message }
    ];
    let previousResponseId: string | undefined;
    let toolOutputs: AgentToolOutput[] | undefined;
    const replyRequirements: ReplyRequirement[] = [];

    for (let step = 0; step < 8; step += 1) {
      const response = await this.model.generate({
        instructions: AGENT_SYSTEM_PROMPT,
        messages,
        tools: [...this.tools.values()].map((tool) => tool.definition),
        previousResponseId,
        toolOutputs
      });

      if (response.toolCalls.length === 0) {
        throw new Error('Agent Core requires a reply tool call before completing a turn.');
      }
      if (response.toolCalls.filter((call) => call.name === 'reply' || call.name === 'escalate').length > 1) {
        throw new Error('Agent Core accepts exactly one reply or escalation action per turn.');
      }

      const nextOutputs: AgentToolOutput[] = [];
      let replyMessage: string | undefined;
      let escalated = false;
      for (const call of response.toolCalls) {
        const tool = this.tools.get(call.name);
        if (!tool) {
          throw new Error(`Agent Core received unsupported tool ${call.name}.`);
        }

        const argumentsValue = parseArguments(call);
        events.push({
          type: 'tool_called',
          conversationId: id,
          turnId,
          sequence: events.length,
          callId: call.callId,
          toolName: call.name,
          arguments: argumentsValue
        });

        const replyArguments = call.name === 'reply' ? parseReplyArguments(argumentsValue) : undefined;
        const escalationArguments =
          call.name === 'escalate' ? parseEscalationArguments(argumentsValue) : undefined;
        const result = await tool.execute(argumentsValue);
        const mustDeliverRequiredMessage = replyRequirements.some(
          (requirement) => requirement.requiredMessage !== undefined
        );
        const automaticEscalationReason =
          replyArguments?.emotionalState === 'FRUSTRATED'
            ? 'CUSTOMER_FRUSTRATED'
            : replyArguments !== undefined && replyArguments.confidence < this.config.confidenceThreshold
              ? 'LOW_CONFIDENCE'
              : undefined;
        events.push({
          type: 'tool_completed',
          conversationId: id,
          turnId,
          sequence: events.length,
          callId: call.callId,
          toolName: call.name,
          result: automaticEscalationReason
            ? { accepted: false, reason: automaticEscalationReason }
            : result.output
        });

        if (result.replyRequirement) {
          replyRequirements.push(result.replyRequirement);
        }

        const emotionalState = replyArguments?.emotionalState ?? escalationArguments?.emotionalState;
        if (replyArguments) {
          events.push({
            type: 'confidence_recorded',
            conversationId: id,
            turnId,
            sequence: events.length,
            confidence: replyArguments.confidence
          });
        }
        if (emotionalState) {
          events.push({
            type: 'customer_emotion_recorded',
            conversationId: id,
            turnId,
            sequence: events.length,
            emotionalState
          });
        }

        if (escalationArguments) {
          if (escalated) throw new Error('Agent Core received multiple escalation tool calls in one turn.');
          escalated = true;
          events.push({
            type: 'escalated',
            conversationId: id,
            turnId,
            sequence: events.length,
            reason: escalationArguments.reason,
            summary: escalationArguments.summary,
            team: escalationArguments.team
          });
        }

        if (result.reply) {
          if (replyMessage !== undefined) {
            throw new Error('Agent Core received multiple reply tool calls in one step.');
          }
          if (automaticEscalationReason) {
            if (mustDeliverRequiredMessage) {
              replyMessage = result.reply;
              events.push({
                type: 'reply_created',
                conversationId: id,
                turnId,
                sequence: events.length,
                message: result.reply
              });
            }
            escalated = true;
            events.push({
              type: 'escalated',
              conversationId: id,
              turnId,
              sequence: events.length,
              reason: automaticEscalationReason,
              summary:
                automaticEscalationReason === 'LOW_CONFIDENCE'
                  ? 'Draft reply confidence was below the configured escalation threshold.'
                  : 'Customer emotional state was frustrated.',
              team: 'General Support'
            });
          } else {
            replyMessage = result.reply;
            events.push({
              type: 'reply_created',
              conversationId: id,
              turnId,
              sequence: events.length,
              message: result.reply
            });
          }
        } else {
          nextOutputs.push({ callId: call.callId, output: JSON.stringify(result.output) });
        }
      }

      if (replyMessage !== undefined || escalated) {
        if (replyMessage !== undefined) {
          assertReplyMeetsRequirements(
            replyMessage,
            replyRequirements,
            this.requiresKnowledgeGrounding
          );
        }
        this.conversations.set(id, [
          ...messages,
          ...(replyMessage === undefined ? [] : [{ role: 'assistant' as const, content: replyMessage }])
        ]);
        return { conversationId: id, reply: replyMessage ?? null, events };
      }

      previousResponseId = response.responseId;
      toolOutputs = nextOutputs;
    }

    throw new Error('Agent Core exceeded the maximum tool-call steps.');
  }
}
