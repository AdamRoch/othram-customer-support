import { describe, expect, it } from 'vitest';
import { createRequesterBoundLookupCaseTool } from '../src/channels/ticket/agent-tools.js';
import { createTicketAgentCoreFactory } from '../src/channels/ticket/agent-core.js';
import type { AgentModel, AgentModelRequest, AgentModelResponse } from '../src/agent-core/core.js';

describe('requester-bound ticket lookup tool', () => {
  it('keeps customer identity out of the model schema and binds it server-side', async () => {
    const inputs: unknown[] = [];
    const tool = createRequesterBoundLookupCaseTool({
      async lookupCase(input) {
        inputs.push(input);
        return { status: 'NOT_FOUND', caseNumber: null, customerMessage: 'Not found.' };
      }
    }, 'requester@othram-demo.test');

    expect(tool.definition.parameters).toEqual({
      type: 'object',
      properties: {
        caseNumber: { type: ['string', 'null'] },
        scope: { type: 'string', enum: ['status', 'beyond_status'] }
      },
      required: ['caseNumber', 'scope'],
      additionalProperties: false
    });
    await tool.execute({ caseNumber: null, scope: 'status' });
    expect(inputs).toEqual([{ channel: 'ticket', scope: 'status', customerEmail: 'requester@othram-demo.test' }]);
  });
});

class ScriptedModel implements AgentModel {
  readonly requests: AgentModelRequest[] = [];
  constructor(private readonly calls: AgentModelResponse['toolCalls'][]) {}
  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    this.requests.push(request);
    return { responseId: `response-${this.requests.length}`, outputText: '', toolCalls: this.calls.shift() ?? [] };
  }
}

describe('ticket AgentCore composition', () => {
  const knowledgeSearch = { async search() { return [{
    content: 'Othram policy text',
    citation: { document: 'Privacy policy', section: 'Consent', category: 'policy', sourcePath: 'policy.md' },
    similarity: 0.9
  }]; } };

  it('uses a requester-bound computed case lookup and cited policy search', async () => {
    const caseModel = new ScriptedModel([
      [{ callId: 'lookup', name: 'lookup_case', arguments: JSON.stringify({ caseNumber: 'OTHRM-1', scope: 'status' }) }],
      [{ callId: 'reply', name: 'reply', arguments: JSON.stringify({ message: 'Computed timeline: sequencing is next.', confidence: 0.9, emotionalState: 'NEUTRAL', knowledgeGroundingDecision: 'NOT_APPLICABLE' }) }]
    ]);
    const lookupInputs: unknown[] = [];
    const caseFactory = createTicketAgentCoreFactory({
      model: caseModel,
      lookupCase: { async lookupCase(input) { lookupInputs.push(input); return { status: 'FOUND', timeline: {} as never, customerMessage: 'Computed timeline.' }; } },
      knowledgeSearch,
      knowledgeGroundingClassifier: { async classify() { return 'NOT_APPLICABLE' as const; } }
    });
    await caseFactory({ requesterEmail: 'jordan@othram-demo.test' }).runTurn('Status please');
    expect(lookupInputs).toEqual([{ channel: 'ticket', scope: 'status', caseNumber: 'OTHRM-1', customerEmail: 'jordan@othram-demo.test' }]);

    const policyModel = new ScriptedModel([
      [{ callId: 'search', name: 'search_knowledge', arguments: JSON.stringify({ query: 'consent policy' }) }],
      [{ callId: 'reply', name: 'reply', arguments: JSON.stringify({ message: 'The policy requires consent. [Privacy policy §Consent]', confidence: 0.9, emotionalState: 'NEUTRAL', knowledgeGroundingDecision: 'REQUIRED' }) }]
    ]);
    const policyFactory = createTicketAgentCoreFactory({
      model: policyModel,
      lookupCase: { async lookupCase() { throw new Error('not used'); } },
      knowledgeSearch,
      knowledgeGroundingClassifier: { async classify() { return 'REQUIRED' as const; } }
    });
    expect((await policyFactory({ requesterEmail: 'jordan@othram-demo.test' }).runTurn('What is the consent policy?')).reply)
      .toContain('[Privacy policy §Consent]');
  });
});
