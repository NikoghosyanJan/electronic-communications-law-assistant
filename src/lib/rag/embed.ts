import OpenAI from "openai";
import { withBackoff } from "@/lib/util/backoff";

export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * OpenAI embedding limit is 8192 tokens. Armenian legal text is extremely
 * token-dense on their tokenizer (~2 tokens/char observed) — 5000 chars fails,
 * 4000 chars succeeds. Keep a hard char budget well under that.
 */
const MAX_EMBED_CHARS = 3_800;

let client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** Truncate text so it fits the embedding model context window. */
export function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_EMBED_CHARS) return text;
  return text.slice(0, MAX_EMBED_CHARS);
}

/**
 * Text used for the embedding vector (may be shorter than stored `content`).
 * Parents and children both include article identity so title terms
 * (e.g. սակագներ) stay in the vector even for short point-level children.
 */
export function embeddingSourceText(chunk: {
  chunkType: "parent" | "child" | string;
  articleNumber: number;
  articleTitle: string;
  content: string;
}): string {
  const header = `Հոդված ${chunk.articleNumber}. ${chunk.articleTitle}`;
  if (chunk.chunkType === "parent") {
    const preview = chunk.content.slice(0, 2_500);
    return `${header}\n\n${preview}`;
  }
  return `${header}\n\n${chunk.content}`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getOpenAI();
  const input = texts.map(truncateForEmbedding);
  return withBackoff(
    async () => {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      return response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    },
    { retries: 4, baseMs: 1000 },
  );
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
