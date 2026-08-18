import { eq, notInArray, sql } from 'drizzle-orm';
import type { createDatabase } from './client.js';
import { cases, customers, knowledgeChunks, stageDurations } from './schema.js';
import type { SeedCase, SeedCustomer } from './seed-data.js';
import type { EmbeddedKnowledgeChunk } from '../knowledge/embeddings.js';

type Database = ReturnType<typeof createDatabase>['db'];

export interface DatabaseSeedData {
  customers: ReadonlyArray<SeedCustomer>;
  cases: ReadonlyArray<SeedCase>;
}

export async function persistSeedData(
  db: Database,
  seedData: DatabaseSeedData,
  stageDurationSeedData: ReadonlyArray<{ stage: SeedCase['currentStage']; standardDays: number }>,
  embeddedChunks: ReadonlyArray<EmbeddedKnowledgeChunk>
): Promise<void> {
  if (embeddedChunks.length === 0) {
    throw new Error('Refusing to persist seed data without knowledge embeddings.');
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(stageDurations)
      .values([...stageDurationSeedData])
      .onConflictDoUpdate({
        target: stageDurations.stage,
        set: { standardDays: sql`excluded.standard_days` }
      });

    const customerIds = new Map<string, string>();
    for (const customer of seedData.customers) {
      const [existingCustomer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.email, customer.email));
      const [seededCustomer] = existingCustomer
        ? await tx
            .update(customers)
            .set(customer)
            .where(eq(customers.id, existingCustomer.id))
            .returning({ id: customers.id })
        : await tx.insert(customers).values(customer).returning({ id: customers.id });

      customerIds.set(customer.email, seededCustomer.id);
    }

    for (const seedCase of seedData.cases) {
      const { customerEmail, ...caseValues } = seedCase;
      const customerId = customerIds.get(customerEmail);
      if (!customerId) {
        throw new Error(`Seed customer missing for ${seedCase.caseNumber}`);
      }

      await tx
        .insert(cases)
        .values({ ...caseValues, customerId })
        .onConflictDoUpdate({
          target: cases.caseNumber,
          set: { ...caseValues, customerId }
        });
    }

    for (const chunk of embeddedChunks) {
      await tx
        .insert(knowledgeChunks)
        .values(chunk)
        .onConflictDoUpdate({
          target: knowledgeChunks.id,
          set: {
            sourcePath: chunk.sourcePath,
            documentTitle: chunk.documentTitle,
            documentSection: chunk.documentSection,
            sectionTitle: chunk.sectionTitle,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contentHash: chunk.contentHash,
            embeddingModel: chunk.embeddingModel,
            embedding: chunk.embedding
          }
        });
    }

    await tx
      .delete(knowledgeChunks)
      .where(notInArray(knowledgeChunks.id, embeddedChunks.map(({ id }) => id)));
  });
}
