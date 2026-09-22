export type Citation = {
  articleNumber: number;
  articleTitle?: string;
};

/** Extract cited article numbers from model output (HY/EN patterns). */
export function extractCitations(answer: string): number[] {
  const found = new Set<number>();
  const patterns = [
    /Հոդված\s*(\d+)/gi,
    /Article\s*(\d+)/gi,
    /Art\.?\s*(\d+)/gi,
  ];
  for (const re of patterns) {
    for (const m of answer.matchAll(re)) {
      found.add(Number(m[1]));
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Keep only citations that appear in the retrieved article set. */
export function filterCitationsToRetrieved(
  citations: number[],
  retrievedArticleNumbers: number[],
): number[] {
  const allowed = new Set(retrievedArticleNumbers);
  return citations.filter((n) => allowed.has(n));
}

export function formatCitationList(
  articles: { articleNumber: number; articleTitle: string }[],
): Citation[] {
  return articles.map((a) => ({
    articleNumber: a.articleNumber,
    articleTitle: a.articleTitle,
  }));
}
