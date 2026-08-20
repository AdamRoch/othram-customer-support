import type { AgentTool } from '../../agent-core/core.js';
import type { LookupCaseTool } from '../../agent-core/tools/lookup-case.js';

/**
 * Ticket requester identity is channel metadata, not model input.  The model
 * can choose a case number and permitted scope, but can never substitute an
 * email address and view another customer's cases.
 */
export function createRequesterBoundLookupCaseTool(
  lookupCase: LookupCaseTool,
  requesterEmail: string
): AgentTool {
  return {
    definition: {
      type: 'function',
      name: 'lookup_case',
      description: 'Look up the ticket requester\'s Othram Case status and computed timeline.',
      parameters: {
        type: 'object',
        properties: {
          caseNumber: { type: ['string', 'null'] },
          scope: { type: 'string', enum: ['status', 'beyond_status'] }
        },
        required: ['caseNumber', 'scope'],
        additionalProperties: false
      },
      strict: true
    },
    async execute(argumentsValue) {
      if (typeof argumentsValue !== 'object' || argumentsValue === null || Array.isArray(argumentsValue)) {
        throw new Error('The lookup_case tool requires an object.');
      }
      const { caseNumber, scope } = argumentsValue as Record<string, unknown>;
      if (caseNumber !== null && typeof caseNumber !== 'string') {
        throw new Error('lookup_case caseNumber must be a string or null.');
      }
      if (scope !== 'status' && scope !== 'beyond_status') {
        throw new Error('lookup_case scope must be status or beyond_status.');
      }
      return {
        output: await lookupCase.lookupCase({
          channel: 'ticket',
          scope,
          ...(caseNumber === null ? {} : { caseNumber }),
          customerEmail: requesterEmail
        })
      };
    }
  };
}
