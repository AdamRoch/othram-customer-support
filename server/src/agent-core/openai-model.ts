import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { AgentModel, AgentModelRequest, AgentModelResponse } from './core.js';

export const DEFAULT_AGENT_MODEL = 'gpt-4.1-mini';

export class OpenAiAgentModel implements AgentModel {
  constructor(
    private readonly client: OpenAI,
    private readonly model = process.env.OPENAI_AGENT_MODEL ?? DEFAULT_AGENT_MODEL
  ) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    const input: ResponseInputItem[] = request.previousResponseId
      ? (request.toolOutputs ?? []).map((result) => ({
          type: 'function_call_output' as const,
          call_id: result.callId,
          output: result.output
        }))
      : request.messages.map((message) => ({ role: message.role, content: message.content }));

    const response = await this.client.responses.create({
      model: this.model,
      instructions: request.instructions,
      input,
      tools: request.tools,
      previous_response_id: request.previousResponseId
    });

    return {
      responseId: response.id,
      outputText: response.output_text,
      toolCalls: response.output
        .filter((item) => item.type === 'function_call')
        .map((call) => ({
          callId: call.call_id,
          name: call.name,
          arguments: call.arguments
        }))
    };
  }
}

export function createOpenAiAgentModel(apiKey: string): OpenAiAgentModel {
  return new OpenAiAgentModel(new OpenAI({ apiKey }));
}
