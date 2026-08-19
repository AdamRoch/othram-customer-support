import { asc, cosineDistance, sql } from 'drizzle-orm';
import type { createDatabase } from '../db/client.js';
import { knowledgeChunks } from '../db/schema.js';
import { embedKnowledgeQuery, type EmbeddingClient } from './embeddings.js';

type Database = ReturnType<typeof createDatabase>['db'];

export const DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 5;
export const MAX_KNOWLEDGE_SEARCH_LIMIT = 10;

export interface KnowledgeCitation {
  document: string;
  section: string;
  category: string;
  sourcePath: string;
}

export interface KnowledgeSearchResult {
  content: string;
  citation: KnowledgeCitation;
  similarity: number;
}

export interface KnowledgeSearchRepository {
  search(embedding: number[], limit: number): Promise<KnowledgeSearchResult[]>;
}

export interface KnowledgeSearchService {
  search(query: string, limit?: number): Promise<KnowledgeSearchResult[]>;
}

export function createKnowledgeSearchRepository(db: Database): KnowledgeSearchRepository {
  return {
    async search(embedding, limit) {
      const distance = cosineDistance(knowledgeChunks.embedding, embedding);
      const rows = await db
        .select({
          content: knowledgeChunks.content,
          document: knowledgeChunks.documentTitle,
          section: knowledgeChunks.sectionTitle,
          category: knowledgeChunks.documentSection,
          sourcePath: knowledgeChunks.sourcePath,
          similarity: sql<number>`1 - (${distance})`
        })
        .from(knowledgeChunks)
        .orderBy(asc(distance))
        .limit(limit);

      return rows.map((row) => ({
        content: row.content,
        citation: {
          document: row.document,
          section: row.section,
          category: row.category,
          sourcePath: row.sourcePath
        },
        similarity: Number(row.similarity)
      }));
    }
  };
}

export function createKnowledgeSearchService(
  repository: KnowledgeSearchRepository,
  embeddingClient: EmbeddingClient
): KnowledgeSearchService {
  return {
    async search(query, limit = DEFAULT_KNOWLEDGE_SEARCH_LIMIT) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_KNOWLEDGE_SEARCH_LIMIT) {
        throw new Error(
          `Knowledge search limit must be an integer from 1 to ${MAX_KNOWLEDGE_SEARCH_LIMIT}.`
        );
      }

      const embedding = await embedKnowledgeQuery(query, embeddingClient);
      return repository.search(embedding, limit);
    }
  };
}
