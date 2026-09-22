import type { RetrievedChunk } from "./retrieve";

/**
 * Build tagged article context for the grounded prompt.
 * Optional `maxChars` keeps free-tier TPM budgets (esp. Groq ~8k) from rejecting the request.
 */
export function assembleContext(
  chunks: RetrievedChunk[],
  options?: { maxChars?: number },
): string {
  if (chunks.length === 0) {
    return "(No relevant articles retrieved.)";
  }

  const maxChars = options?.maxChars;
  if (!maxChars || maxChars <= 0) {
    return chunks
      .map((c) => {
        const header = `[Հոդված ${c.articleNumber} — ${c.articleTitle}]`;
        return `${header}\n${c.content}`;
      })
      .join("\n\n---\n\n");
  }

  const parts: string[] = [];
  let used = 0;
  for (const c of chunks) {
    const header = `[Հոդված ${c.articleNumber} — ${c.articleTitle}]`;
    const sep = parts.length === 0 ? "" : "\n\n---\n\n";
    const room = maxChars - used - sep.length - header.length - 1;
    if (room < 120) break;
    const body =
      c.content.length <= room
        ? c.content
        : `${c.content.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
    const block = `${header}\n${body}`;
    parts.push(block);
    used += sep.length + block.length;
    if (c.content.length > room) break;
  }
  return parts.join("\n\n---\n\n");
}

export function uniqueArticles(
  chunks: RetrievedChunk[],
): { articleNumber: number; articleTitle: string }[] {
  const map = new Map<number, string>();
  for (const c of chunks) {
    if (!map.has(c.articleNumber)) map.set(c.articleNumber, c.articleTitle);
  }
  return [...map.entries()].map(([articleNumber, articleTitle]) => ({
    articleNumber,
    articleTitle,
  }));
}
