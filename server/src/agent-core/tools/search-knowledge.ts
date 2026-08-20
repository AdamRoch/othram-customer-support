import type { KnowledgeSearchResult, KnowledgeSearchService } from '../../knowledge/search.js';
import type { AgentTool } from '../core.js';

export const KNOWLEDGE_NO_RESULTS_MESSAGE =
  "I couldn't find a policy or procedure that answers that. I don't want to improvise, but I can connect you with a specialist who can help.";

export type SearchKnowledgeResult =
  | {
      status: 'FOUND';
      results: KnowledgeSearchResult[];
    }
  | {
      status: 'NO_RESULTS';
      results: [];
      customerMessage: string;
    };

export function formatKnowledgeCitation(result: KnowledgeSearchResult): string {
  return `[${result.citation.document} §${result.citation.section}]`;
}

function queryFrom(argumentsValue: unknown): string {
  if (
    typeof argumentsValue !== 'object' ||
    argumentsValue === null ||
    !('query' in argumentsValue) ||
    typeof argumentsValue.query !== 'string' ||
    !argumentsValue.query.trim()
  ) {
    throw new Error('The search_knowledge tool requires a non-empty query.');
  }

  return argumentsValue.query.trim();
}

export function createSearchKnowledgeTool(searchService: KnowledgeSearchService): AgentTool {
  return {
    definition: {
      type: 'function',
      name: 'search_knowledge',
      description:
        'Retrieve Othram policy and process passages. Use this before answering policy or process questions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 }
        },
        required: ['query'],
        additionalProperties: false
      },
      strict: true
    },
    async execute(argumentsValue) {
      const results = await searchService.search(queryFrom(argumentsValue));
      if (results.length === 0) {
        const output: SearchKnowledgeResult = {
          status: 'NO_RESULTS',
          results: [],
          customerMessage: KNOWLEDGE_NO_RESULTS_MESSAGE
        };
        return {
          output,
          replyRequirement: { requiredMessage: KNOWLEDGE_NO_RESULTS_MESSAGE }
        };
      }

      const output: SearchKnowledgeResult = { status: 'FOUND', results };
      return {
        output,
        replyRequirement: { citationOptions: results.map(formatKnowledgeCitation) }
      };
    }
  };
}
