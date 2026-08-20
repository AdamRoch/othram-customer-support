import './env.js';
import { buildApp } from './app.js';
import { createCaseTimelineRepository } from './cases/repository.js';
import { createDatabase } from './db/client.js';

const database = createDatabase();

try {
  await database.checkConnection();
  const app = await buildApp({
    timelineRepository: createCaseTimelineRepository(database.db)
  });

  app.addHook('onClose', async () => {
    await database.close();
  });

  await app.listen({ port: 3001, host: '127.0.0.1' });
} catch (error) {
  console.error('Database connection failed. Start Postgres with `docker compose up -d` and check DATABASE_URL.', error);
  await database.close();
  process.exit(1);
}
