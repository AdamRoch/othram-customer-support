import './env.js';
import {
  createOpenAiAgentModel,
  createOpenAiKnowledgeGroundingClassifier
} from './agent-core/openai-model.js';
import { createLookupCaseTool } from './agent-core/tools/lookup-case.js';
import { buildApp } from './app.js';
import { createCaseTimelineRepository } from './cases/repository.js';
import { createTicketAgentCoreFactory } from './channels/ticket/agent-core.js';
import { LocalTicketGateway } from './channels/ticket/local-ticket-gateway.js';
import { TicketPollingWorker, type TicketPollingLoop } from './channels/ticket/polling-worker.js';
import { createDatabase } from './db/client.js';
import { createEmbeddingClient, requireOpenAiApiKey } from './knowledge/embeddings.js';
import { createKnowledgeSearchRepository, createKnowledgeSearchService } from './knowledge/search.js';

function localTicketPollingEnabled(value = process.env.LOCAL_TICKET_POLLING_ENABLED): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('LOCAL_TICKET_POLLING_ENABLED must be true or false.');
}

function ticketPollingInterval(value = process.env.LOCAL_TICKET_POLL_INTERVAL_MS): number {
  const interval = value === undefined ? 30_000 : Number(value);
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error('LOCAL_TICKET_POLL_INTERVAL_MS must be a positive integer.');
  }
  return interval;
}

const database = createDatabase();
let pollingLoop: TicketPollingLoop | undefined;

try {
  await database.checkConnection();
  const timelineRepository = createCaseTimelineRepository(database.db);
  const pollingEnabled = localTicketPollingEnabled();
  const pollingInterval = pollingEnabled ? ticketPollingInterval() : undefined;
  const apiKey = pollingEnabled ? requireOpenAiApiKey() : undefined;
  const knowledgeSearchService = apiKey
    ? createKnowledgeSearchService(
        createKnowledgeSearchRepository(database.db),
        createEmbeddingClient(apiKey)
      )
    : undefined;
  const app = await buildApp({
    timelineRepository,
    ...(knowledgeSearchService ? { knowledgeSearchService } : {})
  });

  app.addHook('onClose', async () => {
    await pollingLoop?.stop();
    await database.close();
  });

  let shuttingDown = false;
  const closeForSignal = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down server');
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, 'Server shutdown failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void closeForSignal('SIGINT'));
  process.once('SIGTERM', () => void closeForSignal('SIGTERM'));

  await app.listen({ port: 3001, host: '127.0.0.1' });

  if (apiKey && knowledgeSearchService) {
    const worker = new TicketPollingWorker({
      database: database.db,
      gateway: new LocalTicketGateway(database.db),
      createAgentCore: createTicketAgentCoreFactory({
        model: createOpenAiAgentModel(apiKey),
        lookupCase: createLookupCaseTool({ repository: timelineRepository }),
        knowledgeSearch: knowledgeSearchService,
        knowledgeGroundingClassifier: createOpenAiKnowledgeGroundingClassifier(apiKey)
      })
    });
    pollingLoop = worker.start({
      intervalMs: pollingInterval,
      onError: (error) => app.log.error({ err: error }, 'Local Ticket System poll failed')
    });
    app.log.info('Local Ticket System polling enabled');
  }
} catch (error) {
  await pollingLoop?.stop();
  console.error('Server startup failed. Check Postgres, migrations, and runtime configuration.', error);
  await database.close();
  process.exit(1);
}
