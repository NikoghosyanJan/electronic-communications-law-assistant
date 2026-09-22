import { estimateCostUsd } from "@/lib/llm/pricing";
import { withBackoff } from "@/lib/util/backoff";

export type GoldSubtype =
  | "single"
  | "synthesis"
  | "oos"
  | "near_miss"
  | "underspecified";

export type GoldQuestion = {
  id: string;
  lang: "hy" | "en";
  type: "answerable" | "adversarial";
  /** Optional rubric slice; defaults inferred from type + gold_articles */
  subtype?: GoldSubtype;
  question: string;
  gold_articles: number[];
  /** Atomic must-include claims (not free-form keywords) */
  gold_key_points: string[];
  /** Phrases / patterns that must not appear (hallucination traps) */
  must_not?: string[];
  gold_answer: string;
};

export type ScoreInput = {
  gold: GoldQuestion;
  answer: string | null;
  citations: number[];
  retrievedArticles: number[];
  status: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  ttftMs: number | null;
  totalMs: number;
};

export type ScoreOutput = {
  answerAccuracy: number;
  citationAccuracy: number;
  hallucinationRate: number;
  retrievalRecallAtK: number;
  costUsd: number;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»""„‟]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distinctive tokens for claim matching (EN + HY; keep short HY stems). */
function claimTokens(point: string): string[] {
  return normalize(point)
    .split(/[\s,/;:()]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}%×x\-]/gu, ""))
    .filter((t) => t.length >= 3);
}

function claimHit(answerNorm: string, point: string): boolean {
  const tokens = claimTokens(point);
  if (tokens.length === 0) {
    return answerNorm.includes(normalize(point));
  }
  const matched = tokens.filter((t) => answerNorm.includes(t)).length;
  // Stricter than the old 0.4 bag-of-words: require majority of claim tokens.
  return matched / tokens.length >= 0.6;
}

function mustNotViolations(answer: string, mustNot: string[] | undefined): number {
  if (!mustNot?.length || !answer.trim()) return 0;
  const ans = normalize(answer);
  let hits = 0;
  for (const banned of mustNot) {
    const b = normalize(banned);
    if (!b) continue;
    // Whole-phrase first; else majority of banned tokens (≥3 chars).
    if (ans.includes(b)) {
      hits += 1;
      continue;
    }
    const toks = claimTokens(banned);
    if (toks.length > 0 && toks.filter((t) => ans.includes(t)).length / toks.length >= 0.75) {
      hits += 1;
    }
  }
  return hits;
}

function isRefusal(answer: string): boolean {
  return /cannot|can't|unable|not (covered|found|in (the )?context|within|stated|specified|set)|insufficient|please specify|which article|out of scope|does not (set|prescribe|contain|cover|apply)|no such|not in (this|the) law|դուրս է|չի պարունակ|հնարավոր չէ|բավարար չէ|չեմ կարող|խնդրում եմ նշել|որ հոդված|նշված չէ|չի սահմանում|մերժել/i.test(
    answer,
  );
}

function overlapRatio(predicted: number[], gold: number[]): number {
  // Nothing required to retrieve (adversarial / OOS) → perfect recall.
  if (gold.length === 0) return 1;
  const goldSet = new Set(gold);
  const hits = predicted.filter((n) => goldSet.has(n)).length;
  return hits / gold.length;
}

function citationAccuracyScore(predicted: number[], gold: number[]): number {
  if (gold.length === 0) {
    // Adversarial / out-of-scope: citing nothing is correct; citing inventively is wrong
    return predicted.length === 0 ? 1 : 0;
  }
  if (predicted.length === 0) return 0;
  const goldSet = new Set(gold);
  const correct = predicted.filter((n) => goldSet.has(n)).length;
  // Precision against gold articles
  return correct / predicted.length;
}

function heuristicAnswerAccuracy(gold: GoldQuestion, answer: string): number {
  if (!answer.trim()) return 0;

  const subtype = gold.subtype;
  if (gold.type === "adversarial") {
    const refuse = isRefusal(answer);
    if (subtype === "underspecified") {
      return /please specify|which article|խնդրում եմ նշել|որ հոդված|համարը|article number|clarify/i.test(
        answer,
      )
        ? 1
        : refuse
          ? 0.7
          : 0.15;
    }
    // oos / near_miss: refusal (or “not stated”) is success
    return refuse ? 1 : 0.15;
  }

  const answerNorm = normalize(answer);
  let hits = 0;
  for (const point of gold.gold_key_points) {
    if (claimHit(answerNorm, point)) hits += 1;
  }
  const pointScore =
    gold.gold_key_points.length === 0
      ? 0.5
      : hits / gold.gold_key_points.length;

  const citeBonus = overlapRatio(
    [...answer.matchAll(/Հոդված\s*(\d+)|Article\s*(\d+)/gi)].map((m) =>
      Number(m[1] || m[2]),
    ),
    gold.gold_articles,
  );

  // Penalize must_not leaks on answerable items
  const banned = mustNotViolations(answer, gold.must_not);
  const banPenalty = Math.min(0.4, banned * 0.2);

  return Math.max(0, Math.min(1, pointScore * 0.75 + citeBonus * 0.25 - banPenalty));
}

function heuristicHallucination(
  gold: GoldQuestion,
  answer: string,
  retrievedArticles: number[],
): number {
  if (!answer.trim()) return 0;

  const banned = mustNotViolations(answer, gold.must_not);
  const banRate =
    gold.must_not && gold.must_not.length > 0
      ? Math.min(1, banned / gold.must_not.length)
      : 0;

  if (gold.type === "adversarial") {
    // Correct refusals may mention trap words while denying them ("no AMD rate").
    if (isRefusal(answer)) {
      return 0;
    }
    const inventsCite = /\b(article|հոդված)\s*\d+/i.test(answer);
    return inventsCite || banned > 0 ? Math.max(0.8, banRate || 0.8) : banRate;
  }

  const cited = [
    ...answer.matchAll(/Հոդված\s*(\d+)|Article\s*(\d+)/gi),
  ].map((m) => Number(m[1] || m[2]));
  const retrieved = new Set(retrievedArticles);
  const outsideRate =
    cited.length === 0
      ? 0.1
      : cited.filter((n) => !retrieved.has(n)).length / cited.length;

  return Math.min(1, Math.max(outsideRate, banRate));
}

/**
 * Deterministic claim / must_not scorer (always available).
 * Optional LLM judge can refine answerAccuracy / hallucinationRate.
 */
export function scoreHeuristically(input: ScoreInput): ScoreOutput {
  const answer = input.answer ?? "";
  const failed = input.status !== "ok";

  return {
    answerAccuracy: failed ? 0 : heuristicAnswerAccuracy(input.gold, answer),
    citationAccuracy: failed
      ? 0
      : citationAccuracyScore(input.citations, input.gold.gold_articles),
    hallucinationRate: failed
      ? 1
      : heuristicHallucination(input.gold, answer, input.retrievedArticles),
    retrievalRecallAtK: overlapRatio(
      input.retrievedArticles,
      input.gold.gold_articles,
    ),
    costUsd: estimateCostUsd(
      input.model,
      input.promptTokens,
      input.completionTokens,
    ),
  };
}

export async function scoreWithJudge(
  input: ScoreInput,
): Promise<ScoreOutput & { judgeNotes?: string }> {
  const base = scoreHeuristically(input);
  if (input.status !== "ok" || !input.answer || !process.env.OPENAI_API_KEY) {
    return base;
  }

  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await withBackoff(
      () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You are a strict legal QA judge for a golden eval set.
Return JSON: {"answer_accuracy":0-1,"hallucination_rate":0-1,"notes":"short"}.
Scoring rules:
- answer_accuracy: fraction of gold_key_points (atomic claims) that the candidate supports; ignore wording differences.
- hallucination_rate: fraction of substantive claims that invent law content OR violate must_not.
- For adversarial oos/near_miss: high answer_accuracy if the model refuses / says not covered / not stated; low if it invents penalties, rates, or company facts.
- For underspecified: high if it asks which article / for clarification; low if it summarizes a random article.
- Citations should match gold_articles when the question is answerable.`,
            },
            {
              role: "user",
              content: JSON.stringify({
                question: input.gold.question,
                type: input.gold.type,
                subtype: input.gold.subtype ?? null,
                gold_articles: input.gold.gold_articles,
                gold_key_points: input.gold.gold_key_points,
                must_not: input.gold.must_not ?? [],
                gold_answer: input.gold.gold_answer,
                candidate_answer: input.answer,
                candidate_citations: input.citations,
              }),
            },
          ],
        }),
      { retries: 3, baseMs: 1000 },
    );

    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      answer_accuracy?: number;
      hallucination_rate?: number;
      notes?: string;
    };

    return {
      ...base,
      answerAccuracy:
        typeof parsed.answer_accuracy === "number"
          ? Math.min(1, Math.max(0, parsed.answer_accuracy))
          : base.answerAccuracy,
      hallucinationRate:
        typeof parsed.hallucination_rate === "number"
          ? Math.min(1, Math.max(0, parsed.hallucination_rate))
          : base.hallucinationRate,
      judgeNotes: parsed.notes,
    };
  } catch {
    return base;
  }
}
