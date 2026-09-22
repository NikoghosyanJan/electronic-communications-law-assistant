import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { retrieve } from "@/lib/rag/retrieve";
import { assembleContext, uniqueArticles } from "@/lib/rag/assemble";
import { generateAnswer } from "@/lib/rag/generate";
import { isUnderspecifiedArticleQuestion } from "@/lib/rag/underspecified";
import {
  ALL_PROVIDERS,
  PROVIDER_MODELS,
  type LlmProviderId,
} from "@/lib/llm/types";
import {
  scoreHeuristically,
  scoreWithJudge,
  type GoldQuestion,
  type ScoreInput,
} from "@/lib/eval/score";
import { aggregateMetrics, sleep } from "@/lib/eval/metrics";

export const runtime = "nodejs";
export const maxDuration = 1800;

const GoldQuestionSchema = z.object({
  id: z.string().min(1),
  lang: z.enum(["hy", "en"]),
  type: z.enum(["answerable", "adversarial"]),
  subtype: z
    .enum(["single", "synthesis", "oos", "near_miss", "underspecified"])
    .optional(),
  question: z.string().min(3),
  gold_articles: z.array(z.number().int().positive()),
  gold_key_points: z.array(z.string().min(1)).min(1),
  must_not: z.array(z.string().min(1)).optional(),
  gold_answer: z.string().min(1),
});

const BodySchema = z.object({
  useJudge: z.boolean().optional().default(true),
  providers: z
    .array(z.enum(["openai", "gemini", "groq", "grok"]))
    .optional()
    .default(["openai", "gemini", "groq", "grok"]),
  /** Optional subset for smoke / debug runs */
  questionIds: z.array(z.string()).optional(),
  /** When true, respond with NDJSON progress lines then a final `done` event */
  stream: z.boolean().optional().default(false),
});

function loadGold(): GoldQuestion[] {
  const p = path.join(process.cwd(), "eval", "questions.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const parsed = z.array(GoldQuestionSchema).parse(raw);

  const hyAns = parsed.filter(
    (q) => q.lang === "hy" && q.type === "answerable",
  ).length;
  const enAns = parsed.filter(
    (q) => q.lang === "en" && q.type === "answerable",
  ).length;
  const adv = parsed.filter((q) => q.type === "adversarial").length;
  const synthesis = parsed.filter((q) => q.subtype === "synthesis").length;
  if (parsed.length < 15 || hyAns < 5 || enAns < 5 || adv < 3) {
    throw new Error(
      `Gold set coverage too thin: ${parsed.length} total (need ≥15), ${hyAns} hy answerable (≥5), ${enAns} en answerable (≥5), ${adv} adversarial (≥3)`,
    );
  }
  // Soft check: prefer ≥1 multi-article synthesis item for the brief.
  if (synthesis < 1) {
    console.warn(
      "Gold set has no subtype=synthesis items; brief asks for multi-article synthesis coverage.",
    );
  }

  return parsed;
}

/** List gold questions for Benchmark UI subset controls. */
export async function GET() {
  try {
    const gold = loadGold();
    return Response.json({
      questions: gold.map((q) => ({
        id: q.id,
        lang: q.lang,
        type: q.type,
        question: q.question,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

type ProgressEmit = (event: Record<string, unknown>) => void;

async function runBenchmark(
  body: z.infer<typeof BodySchema>,
  onProgress?: ProgressEmit,
): Promise<{ runId: string; summary: unknown; resultCount: number }> {
  const allGold = loadGold();
  const gold = body.questionIds?.length
    ? allGold.filter((q) => body.questionIds!.includes(q.id))
    : allGold;
  if (gold.length === 0) {
    throw new Error("No gold questions matched questionIds");
  }

  const providers = body.providers.filter((p) =>
    ALL_PROVIDERS.includes(p),
  ) as LlmProviderId[];
  if (providers.length === 0) {
    throw new Error("No valid providers");
  }

  const totalSteps = gold.length * providers.length;
  let step = 0;

  const run = await prisma.evalRun.create({
    data: {
      status: "running",
      startedAt: new Date(),
      notes: `Benchmark ${gold.length} questions × ${providers.length} providers${body.useJudge ? " (judge)" : " (heuristic)"}`,
    },
  });

  try {
    for (const q of gold) {
      let retrievedArticleNums: number[] = [];
      let context = "";
      let usedTranslation = false;
      let queryUsed = q.question;
      let lowConfidence = false;
      let needsClarification = false;
      let retrievalError: string | null = null;

      try {
        needsClarification = isUnderspecifiedArticleQuestion(q.question);
        if (needsClarification) {
          // No retrieval — deictic "this article" must clarify, not summarize neighbors.
          context = "";
          retrievedArticleNums = [];
          lowConfidence = false;
        } else {
          const retrieval = await retrieve(q.question, { forceLang: q.lang });
          context = assembleContext(retrieval.chunks);
          retrievedArticleNums = uniqueArticles(retrieval.chunks).map(
            (a) => a.articleNumber,
          );
          usedTranslation = retrieval.usedTranslation;
          queryUsed = retrieval.queryUsed;
          lowConfidence = retrieval.lowConfidence;
        }
      } catch (err) {
        retrievalError = err instanceof Error ? err.message : String(err);
      }

      for (const provider of providers) {
        step += 1;
        onProgress?.({
          type: "progress",
          step,
          total: totalSteps,
          questionId: q.id,
          provider,
        });

        const generation = retrievalError
          ? {
              provider,
              model: PROVIDER_MODELS[provider],
              text: "",
              promptTokens: 0,
              completionTokens: 0,
              ttftMs: null,
              totalMs: 0,
              status: "error" as const,
              errorMessage: `Retrieval failed: ${retrievalError}`,
              citations: [] as number[],
            }
          : await generateAnswer({
              question: q.question,
              context,
              lang: q.lang,
              provider,
              lowConfidence,
              needsClarification,
            });

        const retrievedSet = new Set(retrievedArticleNums);
        const citations = generation.citations.filter((n) =>
          retrievedSet.has(n),
        );

        const scoreInput: ScoreInput = {
          gold: q,
          answer: generation.text,
          citations,
          retrievedArticles: retrievedArticleNums,
          status: generation.status,
          promptTokens: generation.promptTokens,
          completionTokens: generation.completionTokens,
          model: generation.model,
          ttftMs: generation.ttftMs,
          totalMs: generation.totalMs,
        };

        const scored = body.useJudge
          ? await scoreWithJudge(scoreInput)
          : scoreHeuristically(scoreInput);

        await prisma.evalResult.create({
          data: {
            runId: run.id,
            questionId: q.id,
            provider: generation.provider,
            model: generation.model,
            lang: q.lang,
            questionType: q.type,
            question: q.question,
            answer: generation.text || null,
            citations,
            retrievedArticles: retrievedArticleNums,
            goldArticles: q.gold_articles,
            answerAccuracy: scored.answerAccuracy,
            citationAccuracy: scored.citationAccuracy,
            hallucinationRate: scored.hallucinationRate,
            retrievalRecallAtK: scored.retrievalRecallAtK,
            ttftMs: generation.ttftMs,
            totalMs: generation.totalMs,
            promptTokens: generation.promptTokens,
            completionTokens: generation.completionTokens,
            costUsd: scored.costUsd,
            status: generation.status,
            errorMessage: generation.errorMessage ?? null,
            judgeNotes:
              "judgeNotes" in scored && typeof scored.judgeNotes === "string"
                ? scored.judgeNotes
                : null,
            raw: {
              usedTranslation,
              queryUsed,
              lowConfidence,
              retrievalError,
            },
          },
        });

        await sleep(600);
      }
      await sleep(350);
    }

    const results = await prisma.evalResult.findMany({
      where: { runId: run.id },
    });
    const summary = aggregateMetrics(results);

    await prisma.evalRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        summary,
      },
    });

    return { runId: run.id, summary, resultCount: results.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.evalRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), notes: message },
    });
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json().catch(() => ({})));

    if (!body.stream) {
      try {
        const result = await runBenchmark(body);
        return Response.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status =
          message.includes("No gold") || message.includes("No valid")
            ? 400
            : 500;
        return Response.json({ error: message }, { status });
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          const result = await runBenchmark(body, emit);
          emit({ type: "done", ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emit({ type: "error", error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
