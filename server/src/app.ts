import cors from '@fastify/cors';
import Fastify from 'fastify';
import type {
  CaseTimelineNotFoundResponse,
  CaseTimelineResponse,
  HealthResponse,
  KnowledgeSearchBadRequestResponse,
  KnowledgeSearchResponse
} from '@othram/shared';
import { createCaseTimelineRepository } from './cases/repository.js';
import type { CaseTimelineRepository } from './cases/repository.js';
import { computeCaseTimeline } from './cases/timeline.js';
import { createDatabase } from './db/client.js';
import { createEmbeddingClient, requireOpenAiApiKey } from './knowledge/embeddings.js';
import { createKnowledgeSearchRepository, createKnowledgeSearchService } from './knowledge/search.js';
import type { KnowledgeSearchService } from './knowledge/search.js';

export interface BuildAppOptions {
  timelineRepository?: CaseTimelineRepository;
  knowledgeSearchService?: KnowledgeSearchService;
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const ownedDatabase =
    options.timelineRepository && options.knowledgeSearchService ? null : createDatabase();
  const timelineRepository = options.timelineRepository ?? createCaseTimelineRepository(ownedDatabase!.db);
  let knowledgeSearchService = options.knowledgeSearchService;
  const getKnowledgeSearchService = () => {
    if (!knowledgeSearchService) {
      knowledgeSearchService = createKnowledgeSearchService(
        createKnowledgeSearchRepository(ownedDatabase!.db),
        createEmbeddingClient(requireOpenAiApiKey())
      );
    }
    return knowledgeSearchService;
  };
  const now = options.now ?? (() => new Date());

  if (ownedDatabase) {
    app.addHook('onClose', async () => {
      await ownedDatabase.close();
    });
  }

  await app.register(cors, { origin: 'http://localhost:5173' });

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'othram-support-server'
  }));

  app.get<{ Params: { caseNumber: string } }>(
    '/api/cases/:caseNumber/timeline',
    async (request, reply): Promise<CaseTimelineResponse | CaseTimelineNotFoundResponse> => {
      const input = await timelineRepository.findTimelineInput(request.params.caseNumber);
      if (!input) {
        reply.code(404);
        return {
          error: 'CASE_NOT_FOUND',
          caseNumber: request.params.caseNumber
        };
      }

      return computeCaseTimeline(input.caseRecord, input.stageDurations, now());
    }
  );

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/knowledge/search',
    async (
      request,
      reply
    ): Promise<KnowledgeSearchResponse | KnowledgeSearchBadRequestResponse> => {
      const query = request.query.q?.trim();
      if (!query) {
        reply.code(400);
        return {
          error: 'INVALID_KNOWLEDGE_SEARCH_QUERY',
          message: 'Query parameter q must not be empty.'
        };
      }

      let limit: number | undefined;
      if (request.query.limit !== undefined) {
        if (!/^\d+$/.test(request.query.limit)) {
          reply.code(400);
          return {
            error: 'INVALID_KNOWLEDGE_SEARCH_QUERY',
            message: 'Query parameter limit must be a positive integer.'
          };
        }
        limit = Number(request.query.limit);
      }

      try {
        const results = await getKnowledgeSearchService().search(query, limit);
        return { query, results };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Knowledge search')) {
          reply.code(400);
          return { error: 'INVALID_KNOWLEDGE_SEARCH_QUERY', message: error.message };
        }
        throw error;
      }
    }
  );

  return app;
}
