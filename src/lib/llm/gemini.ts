import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LlmGenerateInput, LlmGenerateResult } from "./types";
import { PROVIDER_MODELS } from "./types";

function classifyGeminiStatus(
  message: string,
): "rate_limit" | "timeout" | "error" {
  if (/404|not found|no longer available/i.test(message)) return "error";
  if (
    /\b429\b|rate[_\s-]?limit|quota[_\s-]?(exceeded|exhausted)/i.test(message)
  ) {
    return "rate_limit";
  }
  if (/timeout|ETIMEDOUT/i.test(message)) return "timeout";
  return "error";
}

export async function generateGemini(
  input: LlmGenerateInput,
): Promise<LlmGenerateResult> {
  const modelName = PROVIDER_MODELS.gemini;
  const started = Date.now();
  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
    if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: input.system,
    });

    const request = {
      contents: [{ role: "user" as const, parts: [{ text: input.user }] }],
      generationConfig: { temperature: input.temperature ?? 0.2 },
    };

    let text = "";
    let ttftMs: number | null = null;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const result = await model.generateContentStream(request);
      for await (const chunk of result.stream) {
        const part = chunk.text();
        if (part) {
          if (ttftMs === null) ttftMs = Date.now() - started;
          text += part;
        }
      }
      const aggregated = await result.response;
      const usage = aggregated.usageMetadata;
      promptTokens = usage?.promptTokenCount ?? 0;
      completionTokens = usage?.candidatesTokenCount ?? 0;
    } catch (streamErr) {
      // Intermittent SDK stream parse failures — fall back to non-streaming.
      const streamMessage =
        streamErr instanceof Error ? streamErr.message : String(streamErr);
      if (!/parse stream|Failed to parse/i.test(streamMessage)) {
        throw streamErr;
      }
      const nonStream = await model.generateContent(request);
      text = nonStream.response.text() ?? "";
      ttftMs = Date.now() - started;
      const usage = nonStream.response.usageMetadata;
      promptTokens = usage?.promptTokenCount ?? 0;
      completionTokens = usage?.candidatesTokenCount ?? 0;
    }

    const totalMs = Date.now() - started;

    if (!text.trim()) {
      return {
        provider: "gemini",
        model: modelName,
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
      provider: "gemini",
      model: modelName,
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
    return {
      provider: "gemini",
      model: modelName,
      text: "",
      promptTokens: 0,
      completionTokens: 0,
      ttftMs: null,
      totalMs,
      status: classifyGeminiStatus(message),
      errorMessage: message,
    };
  }
}
