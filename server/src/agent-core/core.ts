import { randomUUID } from 'node:crypto';
import type { AgentEvent, ChatResponse } from '@othram/shared';
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
}

export interface AgentTool {
  definition: AgentToolDefinition;
  execute(argumentsValue: unknown): Promise<AgentToolResult>;
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

function createReplyTool(): AgentTool {
  return {
    definition: {
      type: 'function',
      name: 'reply',
      description: 'Send the final Customer-facing response for this turn.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', minLength: 1 }
        },
        required: ['message'],
        additionalProperties: false
      },
      strict: true
    },
    async execute(argumentsValue) {
      if (
        typeof argumentsValue !== 'object' ||
        argumentsValue === null ||
        !('message' in argumentsValue) ||
        typeof argumentsValue.message !== 'string' ||
        !argumentsValue.message.trim()
      ) {
        throw new Error('The reply tool requires a non-empty message.');
      }

      const message = argumentsValue.message.trim();
      return { output: { accepted: true }, reply: message };
    }
  };
}

export class AgentCore {
  private readonly conversations = new Map<string, AgentMessage[]>();
  private readonly conversationTails = new Map<string, Promise<void>>();
  private readonly tools: Map<string, AgentTool>;

  constructor(
    private readonly model: AgentModel,
    private readonly createId: () => string = randomUUID,
    tools: AgentTool[] = []
  ) {
    this.tools = new Map(
      [createReplyTool(), ...tools].map((tool) => [tool.definition.name, tool])
    );
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

      const nextOutputs: AgentToolOutput[] = [];
      let replyMessage: string | undefined;
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

        const result = await tool.execute(argumentsValue);
        events.push({
          type: 'tool_completed',
          conversationId: id,
          turnId,
          sequence: events.length,
          callId: call.callId,
          toolName: call.name,
          result: result.output
        });

        if (result.reply) {
          if (replyMessage !== undefined) {
            throw new Error('Agent Core received multiple reply tool calls in one step.');
          }
          replyMessage = result.reply;
          events.push({
            type: 'reply_created',
            conversationId: id,
            turnId,
            sequence: events.length,
            message: result.reply
          });
        } else {
          nextOutputs.push({ callId: call.callId, output: JSON.stringify(result.output) });
        }
      }

      if (replyMessage !== undefined) {
        this.conversations.set(id, [
          ...messages,
          { role: 'assistant', content: replyMessage }
        ]);
        return { conversationId: id, reply: replyMessage, events };
      }

      previousResponseId = response.responseId;
      toolOutputs = nextOutputs;
    }

    throw new Error('Agent Core exceeded the maximum tool-call steps.');
  }
}
