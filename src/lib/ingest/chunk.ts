import type { ParsedArticle } from "./parse-articles";

export type ChunkDraft = {
  articleNumber: number;
  articleTitle: string;
  chapter: string | null;
  chunkType: "parent" | "child";
  content: string;
  tokenEstimate: number;
  /** Temporary key linking children to parent before DB ids exist */
  localParentKey: string | null;
  localKey: string;
  metadata?: Record<string, unknown>;
};

const CHILD_SPLIT =
  /(?=(?:^|\n)\s*(?:\d+\\?\.|[ա-ֆ]\)|\d+\))\s)/u;

const MAX_CHILD_CHARS = 1200;
const MIN_CHILD_CHARS = 80;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function cleanBody(body: string): string {
  return body
    .replace(/\|[-\s|:]+\|/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitOversized(text: string, max = MAX_CHILD_CHARS): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n", max);
    if (cut < max * 0.4) cut = remaining.lastIndexOf(" ", max);
    if (cut < max * 0.4) cut = max;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

/**
 * Parent chunk = full article (for citation identity + fallback).
 * Child chunks = numbered points / lettered sub-points / paragraphs (~800–1200 chars).
 */
export function chunkArticles(articles: ParsedArticle[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];

  for (const article of articles) {
    const body = cleanBody(article.body);
    const parentKey = `parent-${article.articleNumber}`;
    const parentContent = `Հոդված ${article.articleNumber}. ${article.articleTitle}\n\n${body}`;

    chunks.push({
      articleNumber: article.articleNumber,
      articleTitle: article.articleTitle,
      chapter: article.chapter,
      chunkType: "parent",
      content: parentContent,
      tokenEstimate: estimateTokens(parentContent),
      localParentKey: null,
      localKey: parentKey,
      metadata: { role: "article_parent" },
    });

    const rawParts = body
      .split(CHILD_SPLIT)
      .map((p) => p.trim())
      .filter((p) => p.length >= MIN_CHILD_CHARS);

    const parts = rawParts.length > 1 ? rawParts : body ? [body] : [];
    let childIdx = 0;
    for (const part of parts) {
      for (const piece of splitOversized(part)) {
        childIdx += 1;
        chunks.push({
          articleNumber: article.articleNumber,
          articleTitle: article.articleTitle,
          chapter: article.chapter,
          chunkType: "child",
          content: piece,
          tokenEstimate: estimateTokens(piece),
          localParentKey: parentKey,
          localKey: `child-${article.articleNumber}-${childIdx}`,
          metadata: { role: "article_child", childIndex: childIdx },
        });
      }
    }
  }

  return chunks;
}
