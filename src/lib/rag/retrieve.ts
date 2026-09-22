import { prisma } from "@/lib/db/client";
import { embedQuery, vectorLiteral } from "./embed";
import { detectLanguage, type Lang } from "./language";
import OpenAI from "openai";

export type RetrievedChunk = {
  id: string;
  articleNumber: number;
  articleTitle: string;
  chapter: string | null;
  chunkType: string;
  content: string;
  distance: number;
};

const TOP_K_FETCH = 32;
const TOP_K_KEEP = 5;
const MAX_ARTICLES = 4;
/** Cosine distance threshold; higher = weaker match (<=> operator). */
const WEAK_DISTANCE = 0.55;
/**
 * If the best (post-rerank) distance is worse than this, drop context so the
 * model must refuse instead of answering from weak neighbors.
 * Tuned for text-embedding-3-large on this corpus; adversarial OOS queries
 * typically land above ~0.62–0.75 after lexical boosts.
 */
const LOW_CONFIDENCE_DISTANCE = 0.62;

/**
 * Distinctive legal stems for keyword pull + rare-term boost.
 * Topic-specific stems (զեղչ, տեղադր, …) outrank broad ones (սակագն) via TOPIC_STEMS.
 */
const KEYWORD_STEMS = [
  "փոխկապակց",
  "համընդհանուր",
  "սահմանափակ",
  "հեռարձակ",
  "վարձակալ",
  "արդարացի",
  "երկարաձգ",
  "ինտերնետ",
  "գերիշխող",
  "թույլտվ",
  "համարագր",
  "տեղադր",
  "ողջամիտ",
  "սակագն",
  "լիցենզ",
  "սպեկտր",
  "կասեց",
  "զեղչ",
];

/** Stems that are topic-specific; when present in the query, prefer articles that hit them. */
const TOPIC_STEMS = new Set([
  "զեղչ",
  "տեղադր",
  "համընդհանուր",
  "վարձակալ",
  "հեռարձակ",
  "արդարացի",
  "ողջամիտ",
  "երկարաձգ",
  "փոխկապակց",
  "ինտերնետ",
  "գերիշխող",
  "թույլտվ",
  "լիցենզ",
  "սահմանափակ",
  "կասեց",
  "համարագր",
  "սպեկտր",
]);

const TERM_RE = /[\u0531-\u0556\u0561-\u0587A-Za-z]{4,}/g;

/** Map English query hints → Armenian stems (before / without translation). */
function stemsFromEnglishHints(qLower: string, into: Set<string>): void {
  if (/\btariff/.test(qLower)) into.add("սակագն");
  if (/\binternet/.test(qLower)) into.add("ինտերնետ");
  if (/\binterconnect/.test(qLower)) into.add("փոխկապակց");
  if (/\blicen[cs]e/.test(qLower)) into.add("լիցենզ");
  if (/\bdominant/.test(qLower)) into.add("գերիշխող");
  if (/\bdiscount/.test(qLower)) into.add("զեղչ");
  if (/\bcollocat/.test(qLower)) into.add("տեղադր");
  if (/\buniversal\s+service/.test(qLower)) into.add("համընդհանուր");
  if (/\bleased[\s-]?line/.test(qLower)) into.add("վարձակալ");
  if (/\bbroadcast/.test(qLower)) into.add("հեռարձակ");
  if (/\bfair\b|\breasonable\b/.test(qLower)) {
    into.add("արդարացի");
    into.add("ողջամիտ");
  }
  // "What standard must tariffs meet?" → Art 26 fair/reasonable (no "fair" in wording)
  if (
    /\btariff/.test(qLower) &&
    /\b(standard|meet|lawful|unlawful)\b/.test(qLower)
  ) {
    into.add("արդարացի");
    into.add("ողջամիտ");
  }
  if (/\bextend|\bextension\b/.test(qLower)) into.add("երկարաձգ");
}

/** Active keyword stems for this query (HY substrings + EN hints). */
function stemsFromQuery(query: string): Set<string> {
  const q = query.toLowerCase();
  // Substring match covers morphology: զեղչել / զեղչը → զեղչ
  const stems = new Set(KEYWORD_STEMS.filter((s) => q.includes(s)));
  stemsFromEnglishHints(q, stems);
  return stems;
}

/** Collapse Armenian/English surface forms to a search stem. */
function softStem(term: string): string {
  const t = term.toLowerCase();
  for (const s of KEYWORD_STEMS) {
    if (t === s || t.startsWith(s) || t.includes(s)) return s;
  }
  if (t.length >= 6) return t.slice(0, 5);
  if (t.length >= 5) return t.slice(0, 4);
  return t;
}

function termHits(hay: string, term: string): boolean {
  if (hay.includes(term)) return true;
  const stem = softStem(term);
  if (stem.length >= 4 && hay.includes(stem)) return true;
  // Legacy soft stem for Armenian morphology (սակագներ ↔ սակագների)
  if (term.length >= 5) {
    const legacy = term.slice(0, Math.min(6, term.length - 1));
    if (legacy.length >= 4 && hay.includes(legacy)) return true;
  }
  return false;
}

/** Strip punctuation so «Օրենքի նպատակները» matches the article title exactly. */
function normalizeMatchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[՝`ʼ'«»""„.,;:!?()[\]{}<>\-–—|/\\՞։]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Query is the article title (or contains / is contained by it). */
function isNearExactTitleMatch(query: string, title: string): boolean {
  const q = normalizeMatchText(query);
  const t = normalizeMatchText(title);
  if (!q || !t) return false;
  if (q === t) return true;
  // Short title queries like «Օրենքի նպատակները»
  if (q.length >= 8 && (t.includes(q) || q.includes(t))) return true;
  return false;
}

/** Lower effective distance for chunks that share content/title terms with the query. */
function lexicalRerank(
  query: string,
  chunks: RetrievedChunk[],
): RetrievedChunk[] {
  const terms = [...new Set((query.toLowerCase().match(TERM_RE) ?? []).map((t) => t))];
  // Normalize common mistranslations so title «Սակագների» still matches.
  if (terms.some((t) => t.startsWith("սակագ"))) {
    terms.push("սակագն", "սակագներ", "սակագին");
  }
  if (terms.length === 0 && chunks.every((c) => !isNearExactTitleMatch(query, c.articleTitle))) {
    return chunks;
  }

  const uniq = [...new Set(terms)];
  const activeStems = stemsFromQuery(query);
  const topicStems = [...activeStems].filter((s) => TOPIC_STEMS.has(s));

  return [...chunks]
    .map((chunk) => {
      const title = chunk.articleTitle.toLowerCase();
      const body = chunk.content.toLowerCase();
      const hay = `${title}\n${body}`;
      let boost = 0;
      let rareContentHits = 0;
      const exactTitle = isNearExactTitleMatch(query, chunk.articleTitle);

      // Exact / near-exact title match must beat vector neighbors (Art 1 was ~0.65).
      if (exactTitle) {
        boost += 0.55;
      }

      for (const term of uniq) {
        if (termHits(hay, term)) boost += 0.03;
      }
      // Stronger title boost so e.g. «նպատակներ» surfaces Հոդված 1 («…նպատակները»).
      const titleHits = uniq.filter((t) => termHits(title, t)).length;
      if (titleHits > 0) {
        boost += 0.08 + Math.min(titleHits, 3) * 0.06;
      }
      for (const stem of activeStems) {
        if (body.includes(stem) || title.includes(stem)) {
          if (TOPIC_STEMS.has(stem)) {
            rareContentHits += 1;
            boost += 0.12;
          } else if (body.includes(stem)) {
            boost += 0.06;
          } else {
            boost += 0.03;
          }
        }
      }
      // Extra title hit on a topic stem (Զեղչերը / Տեղադրումը) beats long generic titles.
      const topicTitleHits = topicStems.filter((s) => title.includes(s)).length;
      if (topicTitleHits > 0) {
        boost += 0.2 * topicTitleHits;
      }
      // Prefer chunks that hit several topic stems together (արդարացի+ողջամիտ+սակագն → Art 26).
      const topicBodyHits = topicStems.filter(
        (s) => body.includes(s) || title.includes(s),
      ).length;
      if (topicBodyHits >= 2) {
        boost += 0.15 * (topicBodyHits - 1);
      }

      const cappedBoost = exactTitle ? boost : Math.min(boost, 0.35);
      return {
        ...chunk,
        // Rare content hits outrank title-only siblings; allow negative for ranking.
        distance: chunk.distance - cappedBoost - rareContentHits * 0.28,
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

async function vectorSearch(
  embedding: number[],
  limit: number,
): Promise<RetrievedChunk[]> {
  const lit = vectorLiteral(embedding);
  type ChunkRow = {
    id: string;
    articleNumber: number;
    articleTitle: string;
    chapter: string | null;
    chunkType: string;
    content: string;
    distance: number;
  };
  const rows = (await prisma.$queryRawUnsafe(
    `
    SELECT
      id,
      "articleNumber",
      "articleTitle",
      chapter,
      "chunkType"::text AS "chunkType",
      content,
      (embedding <=> $1::vector) AS distance
    FROM law_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
    `,
    lit,
    limit,
  )) as ChunkRow[];
  return rows.map((r): RetrievedChunk => ({
    ...r,
    distance: Number(r.distance),
  }));
}

/** Pull keyword-matching chunks the vector top-k may miss (rare legal terms). */
async function keywordCandidates(
  query: string,
  embedding: number[],
): Promise<RetrievedChunk[]> {
  const stems = stemsFromQuery(query);
  if (stems.size === 0) return [];

  const lit = vectorLiteral(embedding);
  type ChunkRow = {
    id: string;
    articleNumber: number;
    articleTitle: string;
    chapter: string | null;
    chunkType: string;
    content: string;
    distance: number;
  };
  // Fetch per stem so a broad term (սակագն) cannot crowd out a rare one (զեղչ).
  const batches = await Promise.all(
    [...stems].map(async (stem) => {
      const rows = (await prisma.$queryRawUnsafe(
        `
        SELECT
          id,
          "articleNumber",
          "articleTitle",
          chapter,
          "chunkType"::text AS "chunkType",
          content,
          (embedding <=> $1::vector) AS distance
        FROM law_chunks
        WHERE embedding IS NOT NULL
          AND (content ILIKE $2 OR "articleTitle" ILIKE $2)
        ORDER BY
          CASE WHEN "articleTitle" ILIKE $2 THEN 0 ELSE 1 END,
          embedding <=> $1::vector
        LIMIT 8
        `,
        lit,
        `%${stem}%`,
      )) as ChunkRow[];
      return rows.map(
        (r): RetrievedChunk => ({
          ...r,
          distance: Number(r.distance),
        }),
      );
    }),
  );

  return mergeById([], batches.flat());
}

/**
 * Pull chunks whose articleTitle matches query terms. Needed because short
 * title-like queries (e.g. «Օրենքի նպատակները») can rank Article 1 outside
 * vector top-k even though the title is an exact match.
 */
async function titleCandidates(
  query: string,
  embedding: number[],
): Promise<RetrievedChunk[]> {
  const activeStems = [...stemsFromQuery(query)];
  const surfaceTerms = [
    ...new Set((query.toLowerCase().match(TERM_RE) ?? []).map((t) => t)),
  ]
    .filter((t) => t.length >= 5)
    .map((t) => softStem(t))
    .filter((t) => t.length >= 4);
  // Prefer topic stems (զեղչ) over longest generic words (ծառայություններ).
  const patterns = [
    ...new Set([...activeStems, ...surfaceTerms]),
  ]
    .sort((a, b) => {
      const aTopic = TOPIC_STEMS.has(a) ? 1 : 0;
      const bTopic = TOPIC_STEMS.has(b) ? 1 : 0;
      if (aTopic !== bTopic) return bTopic - aTopic;
      return b.length - a.length;
    })
    .slice(0, 6);
  if (patterns.length === 0) return [];

  const lit = vectorLiteral(embedding);
  type ChunkRow = {
    id: string;
    articleNumber: number;
    articleTitle: string;
    chapter: string | null;
    chunkType: string;
    content: string;
    distance: number;
  };

  const batches = await Promise.all(
    patterns.map(async (term) => {
      const rows = (await prisma.$queryRawUnsafe(
        `
        SELECT
          id,
          "articleNumber",
          "articleTitle",
          chapter,
          "chunkType"::text AS "chunkType",
          content,
          (embedding <=> $1::vector) AS distance
        FROM law_chunks
        WHERE embedding IS NOT NULL
          AND "articleTitle" ILIKE $2
        ORDER BY
          CASE WHEN "chunkType" = 'parent' THEN 0 ELSE 1 END,
          embedding <=> $1::vector
        LIMIT 8
        `,
        lit,
        `%${term}%`,
      )) as ChunkRow[];
      return rows.map(
        (r): RetrievedChunk => ({
          ...r,
          distance: Number(r.distance),
        }),
      );
    }),
  );

  return mergeById([], batches.flat());
}

function mergeById(
  primary: RetrievedChunk[],
  extra: RetrievedChunk[],
): RetrievedChunk[] {
  const map = new Map<string, RetrievedChunk>();
  for (const c of [...primary, ...extra]) {
    const prev = map.get(c.id);
    if (!prev || c.distance < prev.distance) map.set(c.id, c);
  }
  return [...map.values()].sort((a, b) => a.distance - b.distance);
}

/** How many distinctive query terms hit the article title (stem-aware). */
function titleTermHits(query: string, title: string): number {
  const terms = [
    ...new Set((query.toLowerCase().match(TERM_RE) ?? []).map((t) => t)),
  ];
  const t = title.toLowerCase();
  return terms.filter((term) => termHits(t, term)).length;
}

function diversifyByArticle(
  query: string,
  chunks: RetrievedChunk[],
): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  const articleCounts = new Map<number, number>();
  const topicStems = [...stemsFromQuery(query)].filter((s) => TOPIC_STEMS.has(s));

  // Articles whose title clearly matches the query (e.g. նպատակներ → Հոդված 1).
  // When the query has a topic stem (զեղչ), do not promote long generic title
  // overlaps (Art 31) that lack that stem — that caused hy-01 to miss Art 30.
  const preferParentArts = new Set(
    chunks
      .filter((c) => {
        if (isNearExactTitleMatch(query, c.articleTitle)) return true;
        const title = c.articleTitle.toLowerCase();
        const body = c.content.toLowerCase();
        if (topicStems.length > 0) {
          const hitsTopic =
            topicStems.some((s) => title.includes(s)) ||
            topicStems.some((s) => body.includes(s));
          if (!hitsTopic) return false;
          if (topicStems.some((s) => title.includes(s))) return true;
          return titleTermHits(query, c.articleTitle) >= 2;
        }
        return titleTermHits(query, c.articleTitle) >= 2;
      })
      .map((c) => c.articleNumber),
  );

  // Promote those articles' parents to the front (use best child distance for ranking).
  const promoted: RetrievedChunk[] = [];
  for (const art of preferParentArts) {
    const parent = chunks.find(
      (c) => c.articleNumber === art && c.chunkType === "parent",
    );
    const best = chunks
      .filter((c) => c.articleNumber === art)
      .sort((a, b) => a.distance - b.distance)[0];
    if (parent) {
      promoted.push({
        ...parent,
        distance: Math.min(parent.distance, best?.distance ?? parent.distance),
      });
    } else if (best) {
      promoted.push(best);
    }
  }
  promoted.sort((a, b) => a.distance - b.distance);

  const ordered = [
    ...promoted,
    ...chunks.filter((c) => !preferParentArts.has(c.articleNumber)),
  ];

  for (const chunk of ordered) {
    const wantParent = preferParentArts.has(chunk.articleNumber);

    if (wantParent) {
      if (chunk.chunkType === "child") continue;
    } else if (
      chunk.chunkType === "parent" &&
      chunks.some(
        (c) =>
          c.articleNumber === chunk.articleNumber &&
          c.chunkType === "child" &&
          c.distance <= chunk.distance + 0.05,
      )
    ) {
      // Prefer point-level children over whole-article parents when both appear
      continue;
    }

    const count = articleCounts.get(chunk.articleNumber) ?? 0;
    if (
      articleCounts.size >= MAX_ARTICLES &&
      !articleCounts.has(chunk.articleNumber)
    ) {
      continue;
    }
    if (count >= 2) continue;
    selected.push(chunk);
    articleCounts.set(chunk.articleNumber, count + 1);
    if (selected.length >= TOP_K_KEEP) break;
  }

  return selected;
}

/**
 * When only child points were selected, load the parent so list/summary
 * questions (e.g. «հիմնական նպատակները») get the full article text.
 */
async function expandWithParents(
  selected: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  if (selected.length === 0) return selected;

  const bestDist = new Map<number, number>();
  for (const c of selected) {
    const prev = bestDist.get(c.articleNumber);
    if (prev === undefined || c.distance < prev) {
      bestDist.set(c.articleNumber, c.distance);
    }
  }

  const needParent = [
    ...new Set(
      selected
        .filter((c) => c.chunkType === "child")
        .map((c) => c.articleNumber),
    ),
  ].filter(
    (n) =>
      !selected.some((c) => c.articleNumber === n && c.chunkType === "parent"),
  );

  if (needParent.length === 0) return selected;

  const parents = await prisma.lawChunk.findMany({
    where: {
      articleNumber: { in: needParent },
      chunkType: "parent",
    },
    select: {
      id: true,
      articleNumber: true,
      articleTitle: true,
      chapter: true,
      chunkType: true,
      content: true,
    },
  });

  const parentByArt = new Map(
    parents.map((p) => [
      p.articleNumber,
      {
        id: p.id,
        articleNumber: p.articleNumber,
        articleTitle: p.articleTitle,
        chapter: p.chapter,
        chunkType: p.chunkType as string,
        content: p.content,
        distance: bestDist.get(p.articleNumber) ?? 1,
      } satisfies RetrievedChunk,
    ]),
  );

  // Replace each article's children with its parent when available.
  const out: RetrievedChunk[] = [];
  const seen = new Set<number>();
  for (const c of selected) {
    if (seen.has(c.articleNumber)) continue;
    seen.add(c.articleNumber);
    const parent = parentByArt.get(c.articleNumber);
    if (parent) {
      out.push(parent);
    } else {
      out.push(...selected.filter((x) => x.articleNumber === c.articleNumber));
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

async function searchAndRank(
  query: string,
  embedding: number[],
): Promise<RetrievedChunk[]> {
  const [vectorHits, keywordHits, titleHits] = await Promise.all([
    vectorSearch(embedding, TOP_K_FETCH),
    keywordCandidates(query, embedding),
    titleCandidates(query, embedding),
  ]);
  const merged = mergeById(vectorHits, mergeById(keywordHits, titleHits));
  const diversified = diversifyByArticle(query, lexicalRerank(query, merged));
  return expandWithParents(diversified);
}

async function translateQueryToArmenian(query: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return query;
  const openai = new OpenAI({ apiKey });
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "Translate the user question into Eastern Armenian for vector retrieval over the Law of the Republic of Armenia on Electronic Communications.",
          "Use statutory terminology from that law when applicable:",
          "Regulator → Կարգավորող; tariff → սակագին; tariffs → սակագներ (never սակագիններ);",
          "internet access → ինտերնետ հասանելիություն; internet service → ինտերնետային ծառայություն;",
          "operator → օպերատոր; interconnection → փոխկապակցում; license → լիցենզիա; dominant → գերիշխող;",
          "discount → զեղչ; collocation → տեղադրում; universal service → համընդհանուր ծառայություն;",
          "leased line → վարձակալված գիծ; broadcast → հեռարձակում; fair and reasonable → արդարացի և ողջամիտ;",
          "general standard tariffs must meet → արդարացի և ողջամիտ սակագներ;",
          "extend / extension (of license) → երկարաձգում.",
          "Return only the Armenian translation, no quotes or commentary.",
        ].join(" "),
      },
      { role: "user", content: query },
    ],
  });
  return res.choices[0]?.message?.content?.trim() || query;
}

export type RetrieveResult = {
  lang: Lang;
  chunks: RetrievedChunk[];
  usedTranslation: boolean;
  queryUsed: string;
  /** True when best neighbor was too weak; chunks may be empty. */
  lowConfidence: boolean;
};

function bestDistance(chunks: RetrievedChunk[]): number {
  return chunks[0]?.distance ?? 1;
}

export async function retrieve(
  question: string,
  options?: { forceLang?: Lang },
): Promise<RetrieveResult> {
  const lang = options?.forceLang ?? detectLanguage(question);
  let queryUsed = question;
  let usedTranslation = false;

  const embedding = await embedQuery(question);
  let chunks = await searchAndRank(question, embedding);

  // EN→HY safety net for Armenian-only corpus: always translate with legal terms
  // and use HY results when they beat the English query (or when EN is weak).
  if (lang === "en") {
    const hy = await translateQueryToArmenian(question);
    if (hy && hy !== question) {
      const hyChunks = await searchAndRank(hy, await embedQuery(hy));
      const enDist = bestDistance(chunks);
      const hyDist = bestDistance(hyChunks);
      if (hyChunks.length > 0 && (enDist > WEAK_DISTANCE || hyDist <= enDist + 0.02)) {
        chunks = hyChunks;
        queryUsed = hy;
        usedTranslation = true;
      }
    }
  }

  const topDist = bestDistance(chunks);
  const lowConfidence = chunks.length === 0 || topDist > LOW_CONFIDENCE_DISTANCE;
  if (lowConfidence) {
    chunks = [];
  }

  return { lang, chunks, usedTranslation, queryUsed, lowConfidence };
}
