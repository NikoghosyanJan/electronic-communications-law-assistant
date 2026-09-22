import type { LlmGenerateInput, LlmGenerateResult, LlmProviderId } from "./types";
import { generateOpenAI } from "./openai";
import { generateGemini } from "./gemini";
import { generateGroq } from "./groq";
import { generateGrok } from "./grok";

export async function generateWithProvider(
  provider: LlmProviderId,
  input: LlmGenerateInput,
): Promise<LlmGenerateResult> {
  switch (provider) {
    case "openai":
      return generateOpenAI(input);
    case "gemini":
      return generateGemini(input);
    case "groq":
      return generateGroq(input);
    case "grok":
      return generateGrok(input);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

export { ALL_PROVIDERS, PROVIDER_MODELS } from "./types";
export type { LlmProviderId, LlmGenerateResult } from "./types";
