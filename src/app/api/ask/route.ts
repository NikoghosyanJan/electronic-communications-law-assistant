import { z } from "zod";
import { retrieve } from "@/lib/rag/retrieve";
import { assembleContext, uniqueArticles } from "@/lib/rag/assemble";
import { loadArticleBodies } from "@/lib/rag/articles";
import { generateAnswer } from "@/lib/rag/generate";
import { detectLanguage } from "@/lib/rag/language";
import { isUnderspecifiedArticleQuestion } from "@/lib/rag/underspecified";
import { estimateCostUsd } from "@/lib/llm/pricing";
import { ALL_PROVIDERS, type LlmProviderId } from "@/lib/llm/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  question: z.string().min(3).max(4000),
  provider: z.enum(["openai", "gemini", "groq", "grok"]).default("openai"),
});

export async function POST(req: Request) {
  try {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const provider = body.provider as LlmProviderId;
    if (!ALL_PROVIDERS.includes(provider)) {
      return Response.json({ error: "Invalid provider" }, { status: 400 });
    }

    const needsClarification = isUnderspecifiedArticleQuestion(body.question);

    // Skip retrieval for deictic "this article" questions — neighbors would
    // only tempt a false summary.
    if (needsClarification) {
      const lang = detectLanguage(body.question);
      const generation = await generateAnswer({
        question: body.question,
        context: "",
        lang,
        provider,
        needsClarification: true,
      });
      const costUsd = estimateCostUsd(
        generation.model,
        generation.promptTokens,
        generation.completionTokens,
      );
      return Response.json({
        answer: generation.text,
        citations: [],
        retrievedArticles: [],
        retrievedChunks: [],
        meta: {
          provider: generation.provider,
          model: generation.model,
          lang,
          usedTranslation: false,
          queryUsed: body.question,
          lowConfidence: false,
          needsClarification: true,
          promptTokens: generation.promptTokens,
          completionTokens: generation.completionTokens,
          ttftMs: generation.ttftMs,
          totalMs: generation.totalMs,
          costUsd,
          status: generation.status,
          errorMessage: generation.errorMessage,
        },
      });
    }

    const retrieval = await retrieve(body.question);
    const context = assembleContext(retrieval.chunks);
    const articles = uniqueArticles(retrieval.chunks);
    const retrievedSet = new Set(articles.map((a) => a.articleNumber));

    const generation = await generateAnswer({
      question: body.question,
      context,
      lang: retrieval.lang,
      provider,
      lowConfidence: retrieval.lowConfidence,
    });

    const costUsd = estimateCostUsd(
      generation.model,
      generation.promptTokens,
      generation.completionTokens,
    );

    // Only surface citations that appear in retrieved context (no invented articles).
    const citedNumbers = generation.citations.filter((n) => retrievedSet.has(n));
    const bodies = await loadArticleBodies([
      ...citedNumbers,
      ...articles.map((a) => a.articleNumber),
    ]);

    const citations = citedNumbers.map((n) => {
      const body = bodies.get(n);
      const title =
        body?.articleTitle ??
        articles.find((a) => a.articleNumber === n)?.articleTitle;
      return {
        articleNumber: n,
        articleTitle: title,
        content: body?.content ?? "",
      };
    });

    const retrievedArticles = articles.map((a) => {
      const body = bodies.get(a.articleNumber);
      return {
        articleNumber: a.articleNumber,
        articleTitle: a.articleTitle,
        content: body?.content ?? "",
      };
    });

    return Response.json({
      answer: generation.text,
      citations,
      retrievedArticles,
      retrievedChunks: retrieval.chunks.map((c) => ({
        articleNumber: c.articleNumber,
        articleTitle: c.articleTitle,
        chunkType: c.chunkType,
        distance: c.distance,
        preview: c.content.slice(0, 240),
      })),
      meta: {
        provider: generation.provider,
        model: generation.model,
        lang: retrieval.lang,
        usedTranslation: retrieval.usedTranslation,
        queryUsed: retrieval.queryUsed,
        lowConfidence: retrieval.lowConfidence,
        needsClarification: false,
        promptTokens: generation.promptTokens,
        completionTokens: generation.completionTokens,
        ttftMs: generation.ttftMs,
        totalMs: generation.totalMs,
        costUsd,
        status: generation.status,
        errorMessage: generation.errorMessage,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
