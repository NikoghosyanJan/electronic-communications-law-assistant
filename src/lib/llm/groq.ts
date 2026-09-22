import Groq from "groq-sdk";
import type { LlmGenerateInput, LlmGenerateResult } from "./types";
import { PROVIDER_MODELS } from "./types";

/**
 * Groq Cloud chat models to try (first match wins).
 * Prefer non-OpenAI weights; Llama 3.x is enterprise-only on free/developer.
 * Override with GROQ_MODEL in .env.local if needed.
 */
const GROQ_MODEL_CANDIDATES = [
  process.env.GROQ_MODEL,
  PROVIDER_MODELS.groq,
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

/** Free-tier TPM (~8k) counts prompt + declared max_tokens — keep this modest. */
const GROQ_MAX_TOKENS = 768;

function isModelMissingError(message: string): boolean {
  return /model_not_found|does not exist|do not have access|404/i.test(message);
}

function classifyGroqStatus(
  message: string,
): "rate_limit" | "timeout" | "error" {
  if (
    /\b429\b|\b413\b|rate[_\s-]?limit|request too large|tokens per minute/i.test(
      message,
    )
  ) {
    return "rate_limit";
  }
  if (/timeout|ETIMEDOUT/i.test(message)) return "timeout";
  return "error";
}

/** Groq Cloud inference (https://console.groq.com) — not xAI Grok */
export async function generateGroq(
  input: LlmGenerateInput,
): Promise<LlmGenerateResult> {
  const started = Date.now();
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return {
      provider: "groq",
      model: PROVIDER_MODELS.groq,
      text: "",
      promptTokens: 0,
      completionTokens: 0,
      ttftMs: null,
      totalMs: Date.now() - started,
      status: "error",
      errorMessage: "GROQ_API_KEY is not set",
    };
  }

  const groq = new Groq({ apiKey });
  let lastError = "";

  for (const model of GROQ_MODEL_CANDIDATES) {
    try {
      const stream = await groq.chat.completions.create({
        model,
        temperature: input.temperature ?? 0.2,
        max_tokens: GROQ_MAX_TOKENS,
        stream: true,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      });

      let text = "";
      let ttftMs: number | null = null;
      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          if (ttftMs === null) ttftMs = Date.now() - started;
          text += delta;
        }
        const usage = (
          chunk as {
            x_groq?: {
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
          }
        ).x_groq?.usage;
        if (usage) {
          promptTokens = usage.prompt_tokens ?? promptTokens;
          completionTokens = usage.completion_tokens ?? completionTokens;
        }
      }

      const totalMs = Date.now() - started;
      if (!text.trim()) {
        return {
          provider: "groq",
          model,
          text: "",
          promptTokens,
          completionTokens,
          ttftMs,
          totalMs,
          status: "malformed",
          errorMessage: "Empty completion",
        };
      }

      if (!promptTokens) {
        promptTokens = Math.ceil((input.system.length + input.user.length) / 4);
      }
      if (!completionTokens) {
        completionTokens = Math.ceil(text.length / 4);
      }

      return {
        provider: "groq",
        model,
        text: text.trim(),
        promptTokens,
        completionTokens,
        ttftMs,
        totalMs,
        status: "ok",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      if (isModelMissingError(message)) {
        // Try next candidate
        continue;
      }
      return {
        provider: "groq",
        model,
        text: "",
        promptTokens: 0,
        completionTokens: 0,
        ttftMs: null,
        totalMs: Date.now() - started,
        status: classifyGroqStatus(message),
        errorMessage: message,
      };
    }
  }

  return {
    provider: "groq",
    model: GROQ_MODEL_CANDIDATES[0] ?? PROVIDER_MODELS.groq,
    text: "",
    promptTokens: 0,
    completionTokens: 0,
    ttftMs: null,
    totalMs: Date.now() - started,
    status: "error",
    errorMessage:
      lastError ||
      `No accessible Groq chat model (tried: ${GROQ_MODEL_CANDIDATES.join(", ")})`,
  };
}
