import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmbeddingClient } from '../src/knowledge/embeddings.js';
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDING_MODEL
} from '../src/knowledge/embeddings.js';
import {
  createKnowledgeSearchService,
  MAX_KNOWLEDGE_SEARCH_LIMIT,
  type KnowledgeSearchRepository,
  type KnowledgeSearchService
} from '../src/knowledge/search.js';
import { buildApp } from '../src/app.js';

function embedding(value: number): number[] {
  return Array.from({ length: KNOWLEDGE_EMBEDDING_DIMENSIONS }, () => value);
}

describe('knowledge search service', () => {
  it('embeds the query and returns citation-ready nearest passages', async () => {
    const create = vi.fn(async () => ({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      data: [{ index: 0, embedding: embedding(0.25) }]
    }));
    const repository: KnowledgeSearchRepository = {
      search: vi.fn(async () => [
        {
          content: 'All requests to use Othram-provided media are always granted.',
          citation: {
            document: 'Media Permission Policy',
            section: 'Policy',
            category: 'Policies',
            sourcePath: 'server/src/knowledge/10-media-permission-policy.md'
          },
          similarity: 0.91
        }
      ])
    };
    const service = createKnowledgeSearchService(repository, {
      embeddings: { create }
    } as EmbeddingClient);

    await expect(service.search('Can I use this photo in an article?')).resolves.toEqual([
      {
        content: 'All requests to use Othram-provided media are always granted.',
        citation: {
          document: 'Media Permission Policy',
          section: 'Policy',
          category: 'Policies',
          sourcePath: 'server/src/knowledge/10-media-permission-policy.md'
        },
        similarity: 0.91
      }
    ]);
    expect(create).toHaveBeenCalledWith({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      input: 'Can I use this photo in an article?',
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      encoding_format: 'float'
    });
    expect(repository.search).toHaveBeenCalledWith(embedding(0.25), 5);
  });

  it('rejects limits outside the bounded search result set', async () => {
    const service = createKnowledgeSearchService(
      { search: vi.fn() },
      { embeddings: { create: vi.fn() } } as EmbeddingClient
    );

    await expect(service.search('policy', 0)).rejects.toThrow('from 1 to');
    await expect(service.search('policy', MAX_KNOWLEDGE_SEARCH_LIMIT + 1)).rejects.toThrow(
      'from 1 to'
    );
  });
});

describe('GET /api/knowledge/search', () => {
  const knowledgeSearchService: KnowledgeSearchService = {
    search: vi.fn(async (query, limit) => [
      {
        content: `Matching passage for ${query}`,
        citation: {
          document: 'Evidence Submission Standard Operating Procedure',
          section: 'Before shipment',
          category: 'Evidence Handling',
          sourcePath: 'server/src/knowledge/06-evidence-submission-sop.md'
        },
        similarity: 0.88 + (limit ?? 0) / 1_000
      }
    ])
  };
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ knowledgeSearchService, logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns passages with document and section citations', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/knowledge/search?q=How+should+evidence+be+packaged%3F&limit=3'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      query: 'How should evidence be packaged?',
      results: [
        {
          content: 'Matching passage for How should evidence be packaged?',
          citation: {
            document: 'Evidence Submission Standard Operating Procedure',
            section: 'Before shipment',
            category: 'Evidence Handling',
            sourcePath: 'server/src/knowledge/06-evidence-submission-sop.md'
          },
          similarity: 0.883
        }
      ]
    });
  });

  it('returns a clear 400 response for missing or invalid parameters', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/knowledge/search' });
    const invalidLimit = await app.inject({ method: 'GET', url: '/api/knowledge/search?q=policy&limit=abc' });

    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({
      error: 'INVALID_KNOWLEDGE_SEARCH_QUERY',
      message: 'Query parameter q must not be empty.'
    });
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidLimit.json()).toEqual({
      error: 'INVALID_KNOWLEDGE_SEARCH_QUERY',
      message: 'Query parameter limit must be a positive integer.'
    });
  });
});
