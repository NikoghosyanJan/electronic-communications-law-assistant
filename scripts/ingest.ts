/**
 * Idempotent law ingest: parse → chunk → embed → upsert Neon (pgvector).
 *
 * Usage:
 *   npm run ingest              # full reload (needs DATABASE_URL + OPENAI_API_KEY)
 *   npm run ingest -- --dry-run # parse + chunk only (no API / DB writes)
 *   npm run ingest -- --verify  # after ingest, probe Art. 22 similarity (default on)
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

import { loadLawText, normalizeLawText, lawPaths } from "../src/lib/ingest/load-law";
import { parseArticles } from "../src/lib/ingest/parse-articles";
import { chunkArticles } from "../src/lib/ingest/chunk";
import type { Prisma } from "@prisma/client";
import {
  embedTexts,
  embedQuery,
  vectorLiteral,
  embeddingSourceText,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from "../src/lib/rag/embed";
import { sleep } from "../src/lib/util/backoff";

const EMBED_BATCH = 16;

function parseFlags(argv: string[]) {
  return {
    dryRun: argv.includes("--dry-run"),
    verify: argv.includes("--verify") || !argv.includes("--no-verify"),
    skipClear: argv.includes("--skip-clear"),
  };
}

async function embedBatched(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch);
    out.push(...vectors);
    console.log(`  embedded ${Math.min(i + EMBED_BATCH, texts.length)} / ${texts.length}`);
    // Brief pause between batches to stay under OpenAI free/paid RPM limits
    if (i + EMBED_BATCH < texts.length) {
      await sleep(350);
    }
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const paths = lawPaths();

  console.log(`Loading ${paths.lawMd}`);
  const raw = loadLawText();
  const text = normalizeLawText(raw);
  const articles = parseArticles(text);
  const chunks = chunkArticles(articles);

  const parents = chunks.filter((c) => c.chunkType === "parent");
  const children = chunks.filter((c) => c.chunkType === "child");

  console.log(
    `Parsed ${articles.length} articles → ${chunks.length} chunks ` +
      `(${parents.length} parents, ${children.length} children)`,
  );

  const art22 = articles.find((a) => a.articleNumber === 22);
  if (!art22) {
    throw new Error("Sanity check failed: Article 22 not found after parse");
  }
  console.log(`Art. 22 title: ${art22.articleTitle}`);

  if (flags.dryRun) {
    console.log("Dry run complete — skipping embed / DB.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (use .env.local)");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set (use .env.local)");
  }

  // Dynamic import so --dry-run works without a live DB adapter
  const { prisma } = await import("../src/lib/db/client");

  try {
    if (!flags.skipClear) {
      console.log("Clearing existing law_chunks…");
      await prisma.$executeRawUnsafe(`DELETE FROM law_chunks`);
    }

    console.log(
      `Embedding with ${EMBEDDING_MODEL} @ ${EMBEDDING_DIMENSIONS}-d…`,
    );
    const embeddings = await embedBatched(
      chunks.map((c) => embeddingSourceText(c)),
    );
    const embeddingByLocalKey = new Map<string, number[]>();
    chunks.forEach((c, i) => {
      const vec = embeddings[i];
      if (!vec || vec.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Bad embedding for ${c.localKey}`);
      }
      embeddingByLocalKey.set(c.localKey, vec);
    });

    console.log("Inserting parents…");
    const idByLocalKey = new Map<string, string>();
    let written = 0;

    for (const chunk of parents) {
      const row = await prisma.lawChunk.create({
        data: {
          articleNumber: chunk.articleNumber,
          articleTitle: chunk.articleTitle,
          chapter: chunk.chapter,
          chunkType: "parent",
          content: chunk.content,
          tokenEstimate: chunk.tokenEstimate,
          metadata: (chunk.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      idByLocalKey.set(chunk.localKey, row.id);
      await setEmbedding(prisma, row.id, embeddingByLocalKey.get(chunk.localKey)!);
      written += 1;
      if (written % 25 === 0 || written === parents.length) {
        console.log(`  parents ${written} / ${parents.length}`);
      }
    }

    console.log("Inserting children…");
    written = 0;
    for (const chunk of children) {
      const parentId = chunk.localParentKey
        ? idByLocalKey.get(chunk.localParentKey)
        : undefined;
      if (!parentId) {
        throw new Error(`Missing parent for ${chunk.localKey}`);
      }
      const row = await prisma.lawChunk.create({
        data: {
          articleNumber: chunk.articleNumber,
          articleTitle: chunk.articleTitle,
          chapter: chunk.chapter,
          parentId,
          chunkType: "child",
          content: chunk.content,
          tokenEstimate: chunk.tokenEstimate,
          metadata: (chunk.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      idByLocalKey.set(chunk.localKey, row.id);
      await setEmbedding(prisma, row.id, embeddingByLocalKey.get(chunk.localKey)!);
      written += 1;
      if (written % 50 === 0 || written === children.length) {
        console.log(`  children ${written} / ${children.length}`);
      }
    }

    const count = await prisma.lawChunk.count();
    console.log(`Stored ${count} law_chunks`);

    if (flags.verify) {
      await verifyArticle22(prisma);
    }

    console.log("Ingest complete.");
  } finally {
    await prisma.$disconnect();
  }
}

async function setEmbedding(
  prisma: { $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown> },
  id: string,
  embedding: number[],
) {
  await prisma.$executeRawUnsafe(
    `UPDATE law_chunks SET embedding = $1::vector WHERE id = $2`,
    vectorLiteral(embedding),
    id,
  );
}

async function verifyArticle22(prisma: {
  $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T>;
}) {
  const probe =
    "Գերիշխող դիրքը էլեկտրոնային հաղորդակցության շուկայում — ինչպե՞ս է սահմանվում";
  console.log(`Verify probe (expect Art. 22): ${probe}`);
  const embedding = await embedQuery(probe);
  const lit = vectorLiteral(embedding);
  const rows = await prisma.$queryRawUnsafe<
    Array<{ articleNumber: number; articleTitle: string; distance: number }>
  >(
    `
    SELECT "articleNumber", "articleTitle", (embedding <=> $1::vector) AS distance
    FROM law_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT 5
    `,
    lit,
  );

  for (const row of rows) {
    console.log(
      `  #${row.articleNumber} ${row.articleTitle} (distance=${Number(row.distance).toFixed(4)})`,
    );
  }

  const hit = rows.some((r) => r.articleNumber === 22);
  if (!hit) {
    throw new Error(
      "Verification failed: Article 22 not in top-5 for dominance probe",
    );
  }
  console.log("Verification OK — Article 22 retrieved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
