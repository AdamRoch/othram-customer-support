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
  private readonly tools: Map<string, AgentTool>;

  constructor(
    private readonly model: AgentModel,
    private readonly createId: () => string = randomUUID,
    tools: AgentTool[] = [createReplyTool()]
  ) {
    this.tools = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  async runTurn(message: string, conversationId?: string): Promise<ChatResponse> {
    const id = conversationId ?? this.createId();
    const existingMessages = conversationId ? this.conversations.get(conversationId) : [];
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
          events.push({
            type: 'reply_created',
            conversationId: id,
            turnId,
            sequence: events.length,
            message: result.reply
          });
          this.conversations.set(id, [
            ...messages,
            { role: 'assistant', content: result.reply }
          ]);
          return { conversationId: id, reply: result.reply, events };
        }

        nextOutputs.push({ callId: call.callId, output: JSON.stringify(result.output) });
      }

      previousResponseId = response.responseId;
      toolOutputs = nextOutputs;
    }

    throw new Error('Agent Core exceeded the maximum tool-call steps.');
  }
}
