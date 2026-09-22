import OpenAI from "openai";
import type { LlmGenerateInput, LlmGenerateResult } from "./types";
import { PROVIDER_MODELS } from "./types";

export async function generateOpenAI(
  input: LlmGenerateInput,
): Promise<LlmGenerateResult> {
  const model = PROVIDER_MODELS.openai;
  const started = Date.now();
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    const openai = new OpenAI({ apiKey });

    const stream = await openai.chat.completions.create({
      model,
      temperature: input.temperature ?? 0.2,
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
        provider: "openai",
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

    return {
      provider: "openai",
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
    return {
      provider: "openai",
      model,
      text: "",
      promptTokens: 0,
      completionTokens: 0,
      ttftMs: null,
      totalMs,
      status,
      errorMessage: message,
    };
  }
}
