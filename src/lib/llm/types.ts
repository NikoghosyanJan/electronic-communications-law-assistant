export type LlmProviderId = "openai" | "gemini" | "groq" | "grok";

export type LlmGenerateInput = {
  system: string;
  user: string;
  temperature?: number;
};

export type LlmGenerateResult = {
  provider: LlmProviderId;
  model: string;
  text: string;
  promptTokens: number;
  completionTokens: number;
  ttftMs: number | null;
  totalMs: number;
  status: "ok" | "error" | "rate_limit" | "timeout" | "malformed";
  errorMessage?: string;
};

export const PROVIDER_MODELS: Record<LlmProviderId, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-3.6-flash",
  /** Groq Cloud — Qwen on Groq (override with GROQ_MODEL). Llama is enterprise-only. */
  groq: "qwen/qwen3.8-27b",
  /** xAI Grok (console.x.ai) — not Groq */
  grok: "grok-4.3",
};

export const ALL_PROVIDERS: LlmProviderId[] = [
  "openai",
  "gemini",
  "groq",
  "grok",
];
