export type ParsedArticle = {
  articleNumber: number;
  articleTitle: string;
  chapter: string | null;
  body: string;
};

const ARTICLE_HEADER =
  /\|\s*\*\*Հոդված\s+(\d+)\.\*\*\s*\|\s*\*\*([^*]+)\*\*\s*\|/g;
const CHAPTER_HEADER = /\*\*Գ\s*Լ\s*ՈՒ\s*Խ\s+(\d+)\*\*/g;

/**
 * Parse ARLIS markdown tables into articles.
 * Expects headers like: | **Հոդված N.** | **Title** |
 */
export function parseArticles(text: string): ParsedArticle[] {
  const chapterRanges: { index: number; label: string }[] = [];
  for (const match of text.matchAll(CHAPTER_HEADER)) {
    chapterRanges.push({
      index: match.index ?? 0,
      label: `Գլուխ ${match[1]}`,
    });
  }

  const headers: {
    articleNumber: number;
    articleTitle: string;
    index: number;
    endOfHeader: number;
  }[] = [];

  for (const match of text.matchAll(ARTICLE_HEADER)) {
    headers.push({
      articleNumber: Number(match[1]),
      articleTitle: match[2].trim(),
      index: match.index ?? 0,
      endOfHeader: (match.index ?? 0) + match[0].length,
    });
  }

  if (headers.length < 50) {
    throw new Error(
      `Parsed only ${headers.length} articles — expected ~60+. Check data/law.md extract quality.`,
    );
  }

  const articles: ParsedArticle[] = [];
  for (let i = 0; i < headers.length; i++) {
    const current = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i + 1].index : text.length;
    let bodyStart = current.endOfHeader;
    const after = text.slice(bodyStart, bodyStart + 120);
    const sep = after.match(/^\s*\n\|[-\s|:]+\|\s*\n/);
    if (sep) bodyStart += sep[0].length;

    const body = text.slice(bodyStart, nextStart).trim();
    const chapter =
      [...chapterRanges].reverse().find((c) => c.index <= current.index)?.label ??
      null;

    articles.push({
      articleNumber: current.articleNumber,
      articleTitle: current.articleTitle,
      chapter,
      body,
    });
  }

  const seen = new Set<number>();
  return articles.filter((a) => {
    if (seen.has(a.articleNumber)) return false;
    seen.add(a.articleNumber);
    return true;
  });
}
