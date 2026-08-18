import OpenAI from 'openai';
import { formatEmbeddingInput, type KnowledgeChunk } from './chunking.js';

export const KNOWLEDGE_EMBEDDING_MODEL = 'text-embedding-3-small';
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1_536;
const DEFAULT_BATCH_SIZE = 128;

interface EmbeddingResponse {
  model: string;
  data: Array<{ index: number; embedding: number[] }>;
}

export interface EmbeddingClient {
  embeddings: {
    create(request: {
      model: string;
      input: string[];
      dimensions: number;
      encoding_format: 'float';
    }): Promise<EmbeddingResponse>;
  };
}

export interface EmbeddedKnowledgeChunk extends KnowledgeChunk {
  embeddingModel: string;
  embedding: number[];
}

export function requireOpenAiApiKey(value = process.env.OPENAI_API_KEY): string {
  const apiKey = value?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required to seed knowledge embeddings; no database seed changes were written.'
    );
  }
  return apiKey;
}

export function createEmbeddingClient(apiKey: string): EmbeddingClient {
  return new OpenAI({ apiKey });
}

function validateBatchResponse(response: EmbeddingResponse, expectedCount: number): number[][] {
  if (response.model !== KNOWLEDGE_EMBEDDING_MODEL) {
    throw new Error(
      `OpenAI returned embedding model ${response.model}; expected ${KNOWLEDGE_EMBEDDING_MODEL}.`
    );
  }
  if (response.data.length !== expectedCount) {
    throw new Error(
      `OpenAI returned ${response.data.length} embeddings for ${expectedCount} knowledge chunks.`
    );
  }

  const byIndex = new Map<number, number[]>();
  for (const item of response.data) {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= expectedCount) {
      throw new Error(`OpenAI returned an invalid embedding index: ${item.index}.`);
    }
    if (byIndex.has(item.index)) {
      throw new Error(`OpenAI returned duplicate embedding index ${item.index}.`);
    }
    if (
      item.embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS ||
      item.embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `OpenAI embedding ${item.index} must contain ${KNOWLEDGE_EMBEDDING_DIMENSIONS} finite values.`
      );
    }
    byIndex.set(item.index, item.embedding);
  }

  return Array.from({ length: expectedCount }, (_, index) => {
    const embedding = byIndex.get(index);
    if (!embedding) {
      throw new Error(`OpenAI response is missing embedding index ${index}.`);
    }
    return embedding;
  });
}

export async function embedKnowledgeChunks(
  chunks: ReadonlyArray<KnowledgeChunk>,
  client: EmbeddingClient,
  batchSize = DEFAULT_BATCH_SIZE
): Promise<EmbeddedKnowledgeChunk[]> {
  if (chunks.length === 0) {
    throw new Error('No knowledge chunks were provided for embedding.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Embedding batch size must be a positive integer.');
  }

  const embeddedChunks: EmbeddedKnowledgeChunk[] = [];
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const response = await client.embeddings.create({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      input: batch.map(formatEmbeddingInput),
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      encoding_format: 'float'
    });
    const embeddings = validateBatchResponse(response, batch.length);

    embeddedChunks.push(
      ...batch.map((chunk, index) => ({
        ...chunk,
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        embedding: embeddings[index]
      }))
    );
  }

  return embeddedChunks;
}
