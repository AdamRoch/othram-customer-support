import 'dotenv/config';
import { createDatabase } from './client.js';
import { knowledgeChunks } from './schema.js';
import { createSeedData, stageDurationSeedData } from './seed-data.js';
import { persistSeedData } from './seed-persistence.js';
import { loadKnowledgeChunks } from '../knowledge/chunking.js';
import {
  createEmbeddingClient,
  embedKnowledgeChunks,
  requireOpenAiApiKey
} from '../knowledge/embeddings.js';

let database: ReturnType<typeof createDatabase> | undefined;

try {
  const seedData = createSeedData();
  const chunks = await loadKnowledgeChunks();
  const apiKey = requireOpenAiApiKey();

  database = createDatabase();
  await database.checkConnection();
  await database.db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).limit(0);

  const embeddedChunks = await embedKnowledgeChunks(chunks, createEmbeddingClient(apiKey));
  await persistSeedData(database.db, seedData, stageDurationSeedData, embeddedChunks);

  console.info(
    `Seeded ${seedData.customers.length} customers, ${seedData.cases.length} cases, ${stageDurationSeedData.length} stage durations, and ${embeddedChunks.length} knowledge chunks.`
  );
} catch (error) {
  console.error(
    'Database seed failed. Set OPENAI_API_KEY, then run `pnpm db:migrate` after starting Postgres with `docker compose up -d`.',
    error
  );
  process.exitCode = 1;
} finally {
  await database?.close();
}
