import OpenAI from "openai";
import type { LlmGenerateInput, LlmGenerateResult } from "./types";
import { PROVIDER_MODELS } from "./types";

/** xAI Grok — OpenAI-compatible Chat Completions at https://api.x.ai/v1 */
export async function generateGrok(
  input: LlmGenerateInput,
): Promise<LlmGenerateResult> {
  const model = PROVIDER_MODELS.grok;
  const started = Date.now();
  try {
    const apiKey = (
      process.env.GROK_API_KEY ||
      process.env.XAI_API_KEY ||
      ""
    ).trim();
    if (!apiKey) {
      throw new Error("GROK_API_KEY is not set (xAI console key from console.x.ai)");
    }
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.x.ai/v1",
    });

    const stream = await client.chat.completions.create({
      model,
      temperature: input.temperature ?? 0.2,
      max_tokens: 2048,
      stream: true,
      stream_options: { include_usage: true },
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
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
    }

    const totalMs = Date.now() - started;
    if (!text.trim()) {
      return {
        provider: "grok",
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

    // Fallback token estimate if usage missing
    if (!promptTokens) {
      promptTokens = Math.ceil((input.system.length + input.user.length) / 4);
    }
    if (!completionTokens) {
      completionTokens = Math.ceil(text.length / 4);
    }

    return {
      provider: "grok",
      model,
      text: text.trim(),
      promptTokens,
      completionTokens,
      ttftMs,
      totalMs,
      status: "ok",
    };
  } catch (err) {
    const totalMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const status = /\b429\b|rate[_\s-]?limit/i.test(message)
      ? "rate_limit"
      : /timeout|ETIMEDOUT/i.test(message)
        ? "timeout"
        : "error";
    const errorMessage = /incorrect api key|invalid.?api.?key|401/i.test(
      message,
    )
      ? `${message} — set a valid xAI key in GROK_API_KEY (console.x.ai), not a Groq key.`
      : message;
    return {
      provider: "grok",
      model,
      text: "",
      promptTokens: 0,
      completionTokens: 0,
      ttftMs: null,
      totalMs,
      status,
      errorMessage,
    };
  }
}
