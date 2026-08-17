import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { HealthResponse } from '@othram/shared';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: 'http://localhost:5173' });

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'othram-support-server'
  }));

  return app;
}
