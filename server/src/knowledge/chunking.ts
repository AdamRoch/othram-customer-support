import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export const KNOWLEDGE_CHUNK_MAX_CHARACTERS = 1_200;

export interface KnowledgeChunk {
  id: string;
  sourcePath: string;
  documentTitle: string;
  documentSection: string;
  sectionTitle: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
}

interface ParsedDocument {
  title: string;
  documentSection: string;
  body: string;
}

interface MarkdownSection {
  title: string;
  content: string;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseFrontmatter(sourcePath: string, markdown: string): ParsedDocument {
  const normalized = markdown.replaceAll('\r\n', '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error(`Knowledge document ${sourcePath} is missing YAML frontmatter.`);
  }

  const metadata = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/);
    if (field) {
      metadata.set(field[1], field[2].trim());
    }
  }

  const title = metadata.get('title');
  const documentSection = metadata.get('section');
  if (!title || !documentSection) {
    throw new Error(`Knowledge document ${sourcePath} must declare title and section frontmatter.`);
  }

  return {
    title,
    documentSection,
    body: normalized.slice(match[0].length).trim()
  };
}

function splitIntoSections(documentTitle: string, body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let sectionTitle = 'Overview';
  let sectionLines: string[] = [];

  const flush = () => {
    const content = sectionLines.join('\n').trim();
    if (content) {
      sections.push({ title: sectionTitle, content });
    }
    sectionLines = [];
  };

  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      sectionTitle = heading[1];
      continue;
    }

    if (line.match(/^#\s+/)) {
      continue;
    }

    sectionLines.push(line);
  }
  flush();

  if (sections.length === 0) {
    throw new Error(`Knowledge document ${documentTitle} has no content to embed.`);
  }

  return sections;
}

function splitLongText(text: string, maxCharacters: number): string[] {
  if (text.length <= maxCharacters) {
    return text ? [text] : [];
  }

  const pieces: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/)) {
    if (!word) continue;

    if (word.length > maxCharacters) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      for (let offset = 0; offset < word.length; offset += maxCharacters) {
        pieces.push(word.slice(offset, offset + maxCharacters));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharacters) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

function chunkSection(content: string, maxCharacters: number): string[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .flatMap((paragraph) => splitLongText(paragraph.trim(), maxCharacters));
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxCharacters) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function chunkKnowledgeDocument(
  sourcePath: string,
  markdown: string,
  maxCharacters = KNOWLEDGE_CHUNK_MAX_CHARACTERS
): KnowledgeChunk[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error('Knowledge chunk size must be a positive integer.');
  }

  const document = parseFrontmatter(sourcePath, markdown);
  const sections = splitIntoSections(document.title, document.body);
  const chunks: KnowledgeChunk[] = [];

  for (const section of sections) {
    for (const content of chunkSection(section.content, maxCharacters)) {
      const chunkIndex = chunks.length;
      chunks.push({
        id: hash(`${sourcePath}\0${chunkIndex}`),
        sourcePath,
        documentTitle: document.title,
        documentSection: document.documentSection,
        sectionTitle: section.title,
        chunkIndex,
        content,
        contentHash: hash(content)
      });
    }
  }

  return chunks;
}

export async function loadKnowledgeChunks(
  knowledgeDirectory = new URL('./', import.meta.url)
): Promise<KnowledgeChunk[]> {
  const fileNames = (await readdir(knowledgeDirectory))
    .filter((fileName) => fileName.endsWith('.md'))
    .sort();
  if (fileNames.length === 0) {
    throw new Error('No Markdown knowledge documents were found to embed.');
  }

  const documents = await Promise.all(
    fileNames.map(async (fileName) => ({
      sourcePath: `server/src/knowledge/${fileName}`,
      markdown: await readFile(new URL(fileName, knowledgeDirectory), 'utf8')
    }))
  );

  return documents.flatMap(({ sourcePath, markdown }) =>
    chunkKnowledgeDocument(sourcePath, markdown)
  );
}

export function formatEmbeddingInput(chunk: KnowledgeChunk): string {
  return [
    `Document: ${chunk.documentTitle}`,
    `Category: ${chunk.documentSection}`,
    `Section: ${chunk.sectionTitle}`,
    '',
    chunk.content
  ].join('\n');
}
