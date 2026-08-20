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
                  emotionalState: 'NEUTRAL',
                  knowledgeGroundingDecision: 'REQUIRED'
                })
              }
            ]
          };
    }
  };
}

describe('search_knowledge Agent Tool', () => {
  it('allows normal case and off-topic replies without search when they declare grounding not applicable', async () => {
    const search = vi.fn(async () => []);
    const core = new AgentCore(
      {
        async generate(request) {
          const offTopic = request.messages.at(-1)?.content.includes('grant') ?? false;
          return {
            responseId: 'response-reply',
            outputText: '',
            toolCalls: [
              {
                callId: 'reply-call',
                name: 'reply',
                arguments: JSON.stringify({
                  message: offTopic
                    ? "I'm here for case-related questions. For grant writing, consult a specialist."
                    : 'Your Case is in review.',
                  confidence: 0.9,
                  emotionalState: 'NEUTRAL',
                  knowledgeGroundingDecision: 'NOT_APPLICABLE'
                })
              }
            ]
          };
        }
      },
      sequentialIds('case-conversation', 'case-turn', 'off-topic-conversation', 'off-topic-turn'),
      [createSearchKnowledgeTool({ search } as KnowledgeSearchService)]
    );

    await expect(core.runTurn('Where is my Case?')).resolves.toMatchObject({ reply: 'Your Case is in review.' });
    await expect(core.runTurn('Help me write a grant proposal.')).resolves.toMatchObject({
      reply: expect.stringContaining('grant writing')
    });
    expect(search).not.toHaveBeenCalled();
  });

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

  it('fails closed if the model replies without searching', async () => {
    const core = new AgentCore(
      {
        async generate() {
          return {
            responseId: 'response-reply',
            outputText: '',
            toolCalls: [
              {
                callId: 'reply-call',
                name: 'reply',
                arguments: JSON.stringify({
                  message: 'You may use the photo.',
                  confidence: 0.9,
                  emotionalState: 'NEUTRAL',
                  knowledgeGroundingDecision: 'REQUIRED'
                })
              }
            ]
          };
        }
      },
      sequentialIds('conversation-1', 'turn-1'),
      [
        createSearchKnowledgeTool({
          async search() {
            return [];
          }
        })
      ]
    );

    await expect(core.runTurn('Can I use an Othram photo?')).rejects.toThrow(
      'reply requires a completed knowledge search'
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

  it('requires the no-results specialist offer verbatim', async () => {
    const core = new AgentCore(
      modelThatSearchesThenReplies(`${KNOWLEDGE_NO_RESULTS_MESSAGE} Is there anything else?`),
      sequentialIds('conversation-1', 'turn-1'),
      [
        createSearchKnowledgeTool({
          async search() {
            return [];
          }
        })
      ]
    );

    await expect(core.runTurn('What is the policy for an unknown process?')).rejects.toThrow(
      'requires the honest no-results response'
    );
  });

  it('delivers the no-results offer while preserving automatic escalation', async () => {
    let calls = 0;
    const core = new AgentCore(
      {
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
                    arguments: '{"query":"unknown policy"}'
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
                      message: KNOWLEDGE_NO_RESULTS_MESSAGE,
                      confidence: 0.1,
                      emotionalState: 'FRUSTRATED',
                      knowledgeGroundingDecision: 'REQUIRED'
                    })
                  }
                ]
              };
        }
      },
      sequentialIds('conversation-1', 'turn-1'),
      [
        createSearchKnowledgeTool({
          async search() {
            return [];
          }
        })
      ]
    );

    const result = await core.runTurn('What is the policy for an unknown process?');

    expect(result.reply).toBe(KNOWLEDGE_NO_RESULTS_MESSAGE);
    expect(result.events.find((event) => event.type === 'escalated')).toMatchObject({
      reason: 'CUSTOMER_FRUSTRATED'
    });
  });

  it('delivers the canonical no-results offer before an explicit escalation', async () => {
    let calls = 0;
    const core = new AgentCore(
      {
        async generate() {
          calls += 1;
          return calls === 1
            ? {
                responseId: 'response-search',
                outputText: '',
                toolCalls: [{ callId: 'search-call', name: 'search_knowledge', arguments: '{"query":"unknown policy"}' }]
              }
            : {
                responseId: 'response-escalate',
                outputText: '',
                toolCalls: [
                  {
                    callId: 'escalate-call',
                    name: 'escalate',
                    arguments: JSON.stringify({
                      reason: 'OUTSIDE_STANDARD_PROCEDURES',
                      summary: 'The Customer needs a specialist.',
                      team: 'General Support',
                      emotionalState: 'NEUTRAL'
                    })
                  }
                ]
              };
        }
      },
      sequentialIds('conversation-1', 'turn-1'),
      [createSearchKnowledgeTool({ async search() { return []; } })]
    );

    const result = await core.runTurn('What is the policy for an unknown process?');

    expect(result.reply).toBe(KNOWLEDGE_NO_RESULTS_MESSAGE);
    expect(result.events.map((event) => event.type).slice(-2)).toEqual(['reply_created', 'escalated']);
    expect(result.events.find((event) => event.type === 'escalated')).toMatchObject({
      reason: 'OUTSIDE_STANDARD_PROCEDURES'
    });
  });

  it('validates a reply that appears before its search in the same tool-call batch', async () => {
    const core = new AgentCore(
      {
        async generate() {
          return {
            responseId: 'response-1',
            outputText: '',
            toolCalls: [
              {
                callId: 'reply-call',
                name: 'reply',
                arguments: JSON.stringify({
                  message: 'Media may be used. [Media Permission Policy §Policy]',
                  confidence: 0.9,
                  emotionalState: 'NEUTRAL',
                  knowledgeGroundingDecision: 'REQUIRED'
                })
              },
              { callId: 'search-call', name: 'search_knowledge', arguments: '{"query":"media"}' }
            ]
          };
        }
      },
      sequentialIds('conversation-1', 'turn-1'),
      [
        createSearchKnowledgeTool({
          async search() {
            return [{
              content: 'Media use policy.',
              citation: {
                document: 'Media Permission Policy', section: 'Policy', category: 'Policies', sourcePath: 'media.md'
              },
              similarity: 0.9
            }];
          }
        })
      ]
    );

    await expect(core.runTurn('Can I use media?')).resolves.toMatchObject({
      reply: 'Media may be used. [Media Permission Policy §Policy]'
    });
  });

  it('uses the latest search outcome when FOUND is followed by NO_RESULTS', async () => {
    let searches = 0;
    let calls = 0;

    // The first model response performs two searches; the second produces the terminal reply.
    const twoSearchesCore = new AgentCore(
      {
        async generate() {
          calls += 1;
          return calls === 1
            ? {
                responseId: 'response-searches', outputText: '', toolCalls: [
                  { callId: 'found-call', name: 'search_knowledge', arguments: '{"query":"media"}' },
                  { callId: 'no-results-call', name: 'search_knowledge', arguments: '{"query":"unknown"}' }
                ]
              }
            : {
                responseId: 'response-reply', outputText: '', toolCalls: [{
                  callId: 'reply-call', name: 'reply', arguments: JSON.stringify({
                    message: KNOWLEDGE_NO_RESULTS_MESSAGE, confidence: 0.9, emotionalState: 'NEUTRAL', knowledgeGroundingDecision: 'REQUIRED'
                  })
                }]
              };
        }
      },
      sequentialIds('conversation-2', 'turn-2'),
      [
        createSearchKnowledgeTool({
          async search() {
            searches += 1;
            return searches === 1
              ? [{
                  content: 'Media use policy.',
                  citation: {
                    document: 'Media Permission Policy', section: 'Policy', category: 'Policies', sourcePath: 'media.md'
                  },
                  similarity: 0.9
                }]
              : [];
          }
        })
      ]
    );

    await expect(twoSearchesCore.runTurn('Tell me the policy.')).resolves.toMatchObject({
      reply: KNOWLEDGE_NO_RESULTS_MESSAGE
    });
  });
});
