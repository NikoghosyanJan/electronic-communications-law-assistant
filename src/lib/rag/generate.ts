import type { Lang } from "./language";
import { answerLanguageInstruction } from "./language";
import type { LlmProviderId, LlmGenerateResult } from "@/lib/llm/types";
import { PROVIDER_MODELS } from "@/lib/llm/types";
import { generateWithProvider } from "@/lib/llm/index";
import { extractCitations } from "./citations";
import { withBackoff } from "@/lib/util/backoff";
import { clarificationMessage } from "./underspecified";

export function buildGroundedPrompt(args: {
  question: string;
  context: string;
  lang: Lang;
  lowConfidence?: boolean;
  needsClarification?: boolean;
}): { system: string; user: string } {
  const system = [
    "You are an internal legal assistant for a telecommunications company in Armenia.",
    "You answer ONLY using the provided excerpts from the Law of the Republic of Armenia on Electronic Communications.",
    "Rules:",
    "- Ground every substantive claim in the context. If the context is insufficient or empty, say you cannot answer from the retrieved law text.",
    "- Cite specific articles as «Հոդված N» (or Article N in English answers).",
    "- Do not invent articles, dates, fines, rates, or obligations not present in the context.",
    "- For questions outside the scope of this law, refuse clearly.",
    "- If the question refers to «այս/տվյալ/սույն հոդված» or \"this/that article\" without naming an article number or a clear topic, ask which article is meant. Do not treat retrieved excerpts as the intended article.",
    "- Never cite an article number that does not appear in the retrieved excerpts.",
    "- You may use light Markdown (bold, numbered/bulleted lists) for readability.",
    answerLanguageInstruction(args.lang),
  ].join("\n");

  if (args.needsClarification) {
    return {
      system,
      user: [
        "Retrieved law excerpts:",
        "(No article was identified. Do not use any law text.)",
        "",
        "Question:",
        args.question,
        "",
        "Ask the user to specify which article (number or topic). Do not summarize law text. Do not cite articles.",
      ].join("\n"),
    };
  }

  const contextBlock =
    args.lowConfidence || !args.context.trim()
      ? "(No sufficiently relevant excerpts were retrieved. Refuse to invent an answer.)"
      : args.context;

  const user = [
    "Retrieved law excerpts:",
    contextBlock,
    "",
    "Question:",
    args.question,
    "",
    args.lowConfidence || !args.context.trim()
      ? "Refuse clearly: the retrieved law text does not support an answer. Do not cite articles."
      : "Provide a concise grounded answer with article citations.",
  ].join("\n");

  return { system, user };
}

export async function generateAnswer(args: {
  question: string;
  context: string;
  lang: Lang;
  provider: LlmProviderId;
  lowConfidence?: boolean;
  needsClarification?: boolean;
}): Promise<LlmGenerateResult & { citations: number[] }> {
  // Deterministic clarify avoids LLM summarizing weak neighbors as "this article".
  if (args.needsClarification) {
    return {
      provider: args.provider,
      model: PROVIDER_MODELS[args.provider],
      text: clarificationMessage(args.lang),
      promptTokens: 0,
      completionTokens: 0,
      ttftMs: null,
      totalMs: 0,
      status: "ok",
      citations: [],
    };
  }

  // Groq free-tier TPM (~8k) charges prompt + declared max_tokens. Cap context
  // so a typical Ask/Benchmark call stays under the ceiling with max_tokens≈1024.
  const contextBudget: Partial<Record<LlmProviderId, number>> = {
    // ~2–3k tokens of Armenian law text + 768 max_tokens stays under Groq free TPM.
    groq: 8_000,
  };
  const budget = contextBudget[args.provider];
  const context =
    budget && args.context.length > budget
      ? truncateContext(args.context, budget)
      : args.context;

  const { system, user } = buildGroundedPrompt({ ...args, context });
  let last: LlmGenerateResult | null = null;

  try {
    const result = await withBackoff(
      async () => {
        last = await generateWithProvider(args.provider, { system, user });
        if (last.status === "rate_limit" || last.status === "timeout") {
          throw new Error(last.errorMessage || last.status);
        }
        return last;
      },
      { retries: 3, baseMs: 1000 },
    );
    return { ...result, citations: extractCitations(result.text ?? "") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback: LlmGenerateResult = last ?? {
      provider: args.provider,
      model: PROVIDER_MODELS[args.provider],
      text: "",
      promptTokens: 0,
      completionTokens: 0,
      ttftMs: null,
      totalMs: 0,
      status: /\b429\b|\b413\b|rate[_\s-]?limit|quota[_\s-]?(exceeded|exhausted)|request too large/i.test(
        message,
      )
        ? "rate_limit"
        : /timeout|ETIMEDOUT/i.test(message)
          ? "timeout"
          : "error",
      errorMessage: message,
    };
    return { ...fallback, citations: extractCitations(fallback.text ?? "") };
  }
}

/** Prefer earlier article blocks; soft-truncate the last block if needed. */
function truncateContext(context: string, maxChars: number): string {
  if (context.length <= maxChars) return context;
  const blocks = context.split(/\n\n---\n\n/);
  const kept: string[] = [];
  let used = 0;
  for (const block of blocks) {
    const sep = kept.length === 0 ? 0 : 7; // "\n\n---\n\n"
    if (used + sep + block.length <= maxChars) {
      kept.push(block);
      used += sep + block.length;
      continue;
    }
    const room = maxChars - used - sep;
    if (room > 200) {
      kept.push(`${block.slice(0, room - 1).trimEnd()}…`);
    }
    break;
  }
  return kept.join("\n\n---\n\n");
}
