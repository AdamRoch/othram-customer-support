import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { CaseTimelineNotFoundResponse, CaseTimelineResponse, HealthResponse } from '@othram/shared';
import { createCaseTimelineRepository } from './cases/repository.js';
import type { CaseTimelineRepository } from './cases/repository.js';
import { computeCaseTimeline } from './cases/timeline.js';
import { createDatabase } from './db/client.js';

export interface BuildAppOptions {
  timelineRepository?: CaseTimelineRepository;
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const ownedDatabase = options.timelineRepository ? null : createDatabase();
  const timelineRepository = options.timelineRepository ?? createCaseTimelineRepository(ownedDatabase!.db);
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

  return app;
}
