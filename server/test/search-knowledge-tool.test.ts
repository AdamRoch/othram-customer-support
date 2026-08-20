import { describe, expect, it, vi } from 'vitest';
import { AgentCore } from '../src/agent-core/core.js';
import {
  createSearchKnowledgeTool,
  KNOWLEDGE_NO_RESULTS_MESSAGE
} from '../src/agent-core/tools/search-knowledge.js';
import type { KnowledgeSearchService } from '../src/knowledge/search.js';

function sequentialIds(...ids: string[]) {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('Test ran out of IDs.');
    return id;
  };
}

function modelThatSearchesThenReplies(reply: string) {
  let calls = 0;
  return {
    async generate() {
      calls += 1;
      return calls === 1
        ? {
            responseId: 'response-search',
            outputText: '',
            toolCalls: [
              {
                callId: 'search-call',
                name: 'search_knowledge',
                arguments: '{"query":"Can I use an Othram photo in an article?"}'
              }
            ]
          }
        : {
            responseId: 'response-reply',
            outputText: '',
            toolCalls: [
              {
                callId: 'reply-call',
                name: 'reply',
                arguments: JSON.stringify({
                  message: reply,
                  confidence: 0.9,
                  emotionalState: 'NEUTRAL'
                })
              }
            ]
          };
    }
  };
}

describe('search_knowledge Agent Tool', () => {
  it('returns media policy passages unchanged and requires their citation in the reply', async () => {
    const search = vi.fn(async () => [
      {
        content: 'All requests to use Othram-provided media are always granted.',
        citation: {
          document: 'Media Permission Policy',
          section: 'Policy',
          category: 'Policies',
          sourcePath: 'server/src/knowledge/10-media-permission-policy.md'
        },
        similarity: 0.97
      }
    ]);
    const core = new AgentCore(
      modelThatSearchesThenReplies(
        'Permission is granted for your requested use of the Othram-provided media. [Media Permission Policy §Policy]'
      ),
      sequentialIds('conversation-1', 'turn-1'),
      [createSearchKnowledgeTool({ search } as KnowledgeSearchService)]
    );

    const result = await core.runTurn('Can I use an Othram photo in an article?');

    expect(result.reply).toContain('[Media Permission Policy §Policy]');
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'tool_completed',
        toolName: 'search_knowledge',
        result: {
          status: 'FOUND',
          results: [
            expect.objectContaining({
              citation: {
                document: 'Media Permission Policy',
                section: 'Policy',
                category: 'Policies',
                sourcePath: 'server/src/knowledge/10-media-permission-policy.md'
              }
            })
          ]
        }
      })
    );
    expect(search).toHaveBeenCalledWith('Can I use an Othram photo in an article?');
  });

  it('requires a source citation for an evidence packaging answer', async () => {
    const core = new AgentCore(
      modelThatSearchesThenReplies(
        'Package each item separately, record identifiers and custodians, and complete chain-of-custody documentation. [Evidence Submission Standard Operating Procedure §Before shipment]'
      ),
      sequentialIds('conversation-1', 'turn-1'),
      [
        createSearchKnowledgeTool({
          async search() {
            return [
              {
                content: 'Package each item separately to prevent transfer or damage.',
                citation: {
                  document: 'Evidence Submission Standard Operating Procedure',
                  section: 'Before shipment',
                  category: 'Evidence Handling',
                  sourcePath: 'server/src/knowledge/06-evidence-submission-sop.md'
                },
                similarity: 0.94
              }
            ];
          }
        })
      ]
    );

    await expect(core.runTurn('How should I package evidence?')).resolves.toMatchObject({
      reply: expect.stringContaining('[Evidence Submission Standard Operating Procedure §Before shipment]')
    });
  });

  it('fails closed if a grounded reply omits the retrieved citation', async () => {
    const core = new AgentCore(
      modelThatSearchesThenReplies('Yes, you may use the photo.'),
      sequentialIds('conversation-1', 'turn-1'),
      [
        createSearchKnowledgeTool({
          async search() {
            return [
              {
                content: 'All requests to use Othram-provided media are always granted.',
                citation: {
                  document: 'Media Permission Policy',
                  section: 'Policy',
                  category: 'Policies',
                  sourcePath: 'server/src/knowledge/10-media-permission-policy.md'
                },
                similarity: 0.97
              }
            ];
          }
        })
      ]
    );

    await expect(core.runTurn('Can I use an Othram photo?')).rejects.toThrow(
      'knowledge-grounded reply must include a citation'
    );
  });

  it('returns an honest specialist offer when retrieval has no results', async () => {
    const core = new AgentCore(
      modelThatSearchesThenReplies(KNOWLEDGE_NO_RESULTS_MESSAGE),
      sequentialIds('conversation-1', 'turn-1'),
      [
        createSearchKnowledgeTool({
          async search() {
            return [];
          }
        })
      ]
    );

    await expect(core.runTurn('What is the policy for an unknown process?')).resolves.toMatchObject({
      reply: KNOWLEDGE_NO_RESULTS_MESSAGE,
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_completed',
          toolName: 'search_knowledge',
          result: {
            status: 'NO_RESULTS',
            results: [],
            customerMessage: KNOWLEDGE_NO_RESULTS_MESSAGE
          }
        })
      ])
    });
  });
});
