import { afterAll, describe, expect, it } from 'vitest';
import { AgentCore } from '../src/agent-core/core.js';
import type { AgentModel } from '../src/agent-core/core.js';
import { buildApp } from '../src/app.js';
import type { CaseTimelineRepository } from '../src/cases/repository.js';
import type { KnowledgeSearchService } from '../src/knowledge/search.js';

const model: AgentModel = {
  async generate(request) {
    return {
      responseId: 'response-1',
      outputText: '',
      toolCalls: [
        {
          callId: 'call-1',
          name: 'reply',
          arguments: JSON.stringify({ message: `You said: ${request.messages.at(-1)?.content}` })
        }
      ]
    };
  }
};
const ids = ['conversation-1', 'turn-1', 'turn-2'];
const agentCore = new AgentCore(model, () => ids.shift() ?? 'extra-id');
const timelineRepository: CaseTimelineRepository = {
  async findTimelineInput() {
    return null;
  }
};
const knowledgeSearchService: KnowledgeSearchService = {
  async search() {
    return [];
  }
};
const app = await buildApp({
  agentCore,
  timelineRepository,
  knowledgeSearchService,
  logger: false
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/chat', () => {
  it('starts and continues a conversation', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 'Hello' }
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { conversationId: 'conversation-1', message: 'One more thing' }
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      conversationId: 'conversation-1',
      reply: 'You said: Hello'
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      conversationId: 'conversation-1',
      reply: 'You said: One more thing'
    });
  });

  it('rejects empty messages and unknown conversation IDs', async () => {
    const empty = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: ' ' } });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { conversationId: 'missing', message: 'Hello?' }
    });

    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: 'INVALID_CHAT_REQUEST' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: 'CONVERSATION_NOT_FOUND' });
  });

  it('rejects invalid JSON field types', async () => {
    const invalidMessage = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 1 }
    });
    const invalidConversationId = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { conversationId: 1, message: 'Hello' }
    });

    expect(invalidMessage.statusCode).toBe(400);
    expect(invalidMessage.json()).toMatchObject({ error: 'INVALID_CHAT_REQUEST' });
    expect(invalidConversationId.statusCode).toBe(400);
    expect(invalidConversationId.json()).toMatchObject({ error: 'INVALID_CHAT_REQUEST' });
  });
});
