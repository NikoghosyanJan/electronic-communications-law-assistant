import { prisma } from "@/lib/db/client";

export type ArticleBody = {
  articleNumber: number;
  articleTitle: string;
  content: string;
};

/** Load full parent-chunk text for the given article numbers. */
export async function loadArticleBodies(
  articleNumbers: number[],
): Promise<Map<number, ArticleBody>> {
  const unique = [...new Set(articleNumbers)].filter((n) => n > 0);
  if (unique.length === 0) return new Map();

  const parents = await prisma.lawChunk.findMany({
    where: {
      articleNumber: { in: unique },
      chunkType: "parent",
    },
    select: {
      articleNumber: true,
      articleTitle: true,
      content: true,
    },
  });

  return new Map(
    parents.map((p) => [
      p.articleNumber,
      {
        articleNumber: p.articleNumber,
        articleTitle: p.articleTitle,
        content: p.content,
      },
    ]),
  );
}
