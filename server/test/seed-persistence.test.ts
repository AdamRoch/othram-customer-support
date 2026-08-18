import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/client.js';
import { knowledgeChunks } from '../src/db/schema.js';
import { createSeedData, stageDurationSeedData } from '../src/db/seed-data.js';
import { persistSeedData } from '../src/db/seed-persistence.js';
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDING_MODEL,
  type EmbeddedKnowledgeChunk
} from '../src/knowledge/embeddings.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
if (testDatabaseUrl) {
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (!/(?:^|[_-])test(?:$|[_-])/.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL must name an isolated test database.');
  }
}
const database = testDatabaseUrl ? createDatabase(testDatabaseUrl) : undefined;

function embeddedChunk(index: number, content = `Content ${index}`): EmbeddedKnowledgeChunk {
  return {
    id: `chunk-${index}`,
    sourcePath: 'server/src/knowledge/test.md',
    documentTitle: 'Test Document',
    documentSection: 'Tests',
    sectionTitle: `Section ${index}`,
    chunkIndex: index,
    content,
    contentHash: `hash-${content}`,
    embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    embedding: Array.from({ length: KNOWLEDGE_EMBEDDING_DIMENSIONS }, () => index + 0.5)
  };
}

describeWithDatabase('database seed persistence', () => {
  beforeAll(async () => {
    if (!database) return;
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
    });
  });

  afterAll(async () => {
    await database?.close();
  });

  it('upserts chunks idempotently with metadata and removes stale chunks', async () => {
    if (!database) throw new Error('TEST_DATABASE_URL was not configured.');
    const seedData = createSeedData(new Date('2026-08-17T12:00:00.000Z'));

    await persistSeedData(database.db, seedData, stageDurationSeedData, [
      embeddedChunk(0),
      embeddedChunk(1)
    ]);
    await persistSeedData(database.db, seedData, stageDurationSeedData, [
      embeddedChunk(0, 'Updated content')
    ]);

    const rows = await database.db.select().from(knowledgeChunks);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: 'chunk-0',
        documentTitle: 'Test Document',
        documentSection: 'Tests',
        sectionTitle: 'Section 0',
        content: 'Updated content',
        embeddingModel: 'text-embedding-3-small'
      })
    );
    expect(rows[0].embedding).toHaveLength(1536);
  });
});
