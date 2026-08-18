import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeChunk } from '../src/knowledge/chunking.js';
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDING_MODEL,
  embedKnowledgeChunks,
  requireOpenAiApiKey,
  type EmbeddingClient
} from '../src/knowledge/embeddings.js';

function chunk(index: number): KnowledgeChunk {
  return {
    id: `chunk-${index}`,
    sourcePath: 'server/src/knowledge/test.md',
    documentTitle: 'Test Document',
    documentSection: 'Tests',
    sectionTitle: `Section ${index}`,
    chunkIndex: index,
    content: `Content ${index}`,
    contentHash: `hash-${index}`
  };
}

function vector(value: number): number[] {
  return Array.from({ length: KNOWLEDGE_EMBEDDING_DIMENSIONS }, () => value);
}

describe('knowledge embeddings', () => {
  it('fails closed when OPENAI_API_KEY is missing', () => {
    expect(() => requireOpenAiApiKey(undefined)).toThrow('OPENAI_API_KEY is required');
    expect(() => requireOpenAiApiKey('   ')).toThrow('no database seed changes were written');
    expect(requireOpenAiApiKey(' test-key ')).toBe('test-key');
  });

  it('uses the required model and restores response order across batches', async () => {
    const create = vi.fn(async (request: { input: string[] }) => ({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      data: request.input.map((_, index) => ({ index, embedding: vector(index + 1) })).reverse()
    }));
    const client = { embeddings: { create } } as EmbeddingClient;

    const embedded = await embedKnowledgeChunks([chunk(0), chunk(1), chunk(2)], client, 2);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'text-embedding-3-small',
        dimensions: 1536,
        encoding_format: 'float'
      })
    );
    expect(create.mock.calls[0][0].input[0]).toContain(
      'Document: Test Document\nCategory: Tests\nSection: Section 0'
    );
    expect(embedded.map(({ embedding }) => embedding[0])).toEqual([1, 2, 1]);
    expect(embedded.every(({ embeddingModel }) => embeddingModel === KNOWLEDGE_EMBEDDING_MODEL)).toBe(
      true
    );
  });

  it('rejects malformed OpenAI responses before persistence', async () => {
    const client = {
      embeddings: {
        create: vi.fn(async () => ({
          model: KNOWLEDGE_EMBEDDING_MODEL,
          data: [{ index: 0, embedding: [1, 2, 3] }]
        }))
      }
    } as EmbeddingClient;

    await expect(embedKnowledgeChunks([chunk(0)], client)).rejects.toThrow(
      'must contain 1536 finite values'
    );
  });
});
