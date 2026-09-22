/** Paid list prices (USD per 1M tokens) for reporting — even on free tier. */
export const PRICING_PER_1M: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  // Groq Cloud — Qwen 3.8 27B (preview); falls back in groq.ts if unavailable
  "qwen/qwen3.8-27b": { input: 0.8, output: 4.0 },
  "qwen/qwen3.6-27b": { input: 0.6, output: 3.0 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
  // xAI Grok 4.3 standard (< 200k prompt)
  "grok-4.3": { input: 1.25, output: 2.5 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = PRICING_PER_1M[model];
  if (!p) return 0;
  return (
    (promptTokens / 1_000_000) * p.input +
    (completionTokens / 1_000_000) * p.output
  );
}
