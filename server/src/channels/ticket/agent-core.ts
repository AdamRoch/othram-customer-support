import {
  AgentCore,
  type AgentCoreConfig,
  type AgentModel,
  type KnowledgeGroundingClassifier
} from '../../agent-core/core.js';
import { createSearchKnowledgeTool } from '../../agent-core/tools/search-knowledge.js';
import type { LookupCaseTool } from '../../agent-core/tools/lookup-case.js';
import type { KnowledgeSearchService } from '../../knowledge/search.js';
import { createRequesterBoundLookupCaseTool } from './agent-tools.js';

export interface TicketAgentCoreDependencies {
  model: AgentModel;
  lookupCase: LookupCaseTool;
  knowledgeSearch: KnowledgeSearchService;
  knowledgeGroundingClassifier?: KnowledgeGroundingClassifier;
  config?: AgentCoreConfig;
}

/** Creates a fresh, requester-bound core for one durable ticket work attempt. */
export function createTicketAgentCoreFactory(dependencies: TicketAgentCoreDependencies) {
  return ({ requesterEmail }: { requesterEmail: string }) =>
    new AgentCore(
      dependencies.model,
      undefined,
      [
        createRequesterBoundLookupCaseTool(dependencies.lookupCase, requesterEmail),
        createSearchKnowledgeTool(dependencies.knowledgeSearch)
      ],
      dependencies.config,
      dependencies.knowledgeGroundingClassifier
    );
}
