import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_CHUNK_MAX_CHARACTERS,
  chunkKnowledgeDocument,
  formatEmbeddingInput,
  loadKnowledgeChunks
} from '../src/knowledge/chunking.js';

describe('knowledge document chunking', () => {
  it('chunks every bundled document with citation metadata', async () => {
    const chunks = await loadKnowledgeChunks();
    const sourcePaths = new Set(chunks.map(({ sourcePath }) => sourcePath));

    expect(sourcePaths.size).toBe(18);
    expect(chunks.length).toBeGreaterThan(sourcePaths.size);
    expect(new Set(chunks.map(({ id }) => id)).size).toBe(chunks.length);
    expect(
      chunks.every(
        (chunk) =>
          chunk.documentTitle.length > 0 &&
          chunk.documentSection.length > 0 &&
          chunk.sectionTitle.length > 0 &&
          chunk.content.length > 0 &&
          chunk.content.length <= KNOWLEDGE_CHUNK_MAX_CHARACTERS
      )
    ).toBe(true);

    expect(chunks).toContainEqual(
      expect.objectContaining({
        documentTitle: 'Media Permission Policy',
        documentSection: 'Policies',
        sectionTitle: 'Policy'
      })
    );
  });

  it('is deterministic and preserves section boundaries', () => {
    const markdown = `---
title: Shipping Guide
section: Evidence Handling
---

# Shipping Guide

Introductory guidance.

## Before shipment

Keep the evidence sealed.

## At shipment

Use the assigned carrier.`;

    const first = chunkKnowledgeDocument('knowledge/shipping.md', markdown);
    const second = chunkKnowledgeDocument('knowledge/shipping.md', markdown);

    expect(second).toEqual(first);
    expect(first.map(({ sectionTitle }) => sectionTitle)).toEqual([
      'Overview',
      'Before shipment',
      'At shipment'
    ]);
    expect(formatEmbeddingInput(first[1])).toContain(
      'Document: Shipping Guide\nCategory: Evidence Handling\nSection: Before shipment'
    );
  });

  it('splits oversized sections without exceeding the configured limit', () => {
    const markdown = `---
title: Long Guide
section: Process
---

# Long Guide

## Details

${Array.from({ length: 30 }, (_, index) => `word-${index}`).join(' ')}`;
    const chunks = chunkKnowledgeDocument('knowledge/long.md', markdown, 40);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(({ content }) => content.length <= 40)).toBe(true);
    expect(chunks.map(({ chunkIndex }) => chunkIndex)).toEqual(
      chunks.map((_, index) => index)
    );
  });

  it('rejects documents that cannot produce trustworthy citation metadata', () => {
    expect(() => chunkKnowledgeDocument('knowledge/bad.md', '# Missing metadata')).toThrow(
      'missing YAML frontmatter'
    );
    expect(() =>
      chunkKnowledgeDocument(
        'knowledge/bad.md',
        '---\ntitle: Missing section\n---\n\n# Missing section\n\nContent'
      )
    ).toThrow('must declare title and section');
  });
});
