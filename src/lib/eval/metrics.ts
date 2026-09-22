import type { EvalResult } from "@prisma/client";

export type ProviderMetrics = {
  provider: string;
  model: string;
  n: number;
  answerAccuracy: number;
  citationAccuracy: number;
  hallucinationRate: number;
  retrievalRecallAtK: number;
  ttftMsP50: number | null;
  ttftMsP95: number | null;
  totalMsP50: number | null;
  totalMsP95: number | null;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  totalCostUsd: number;
  failureRate: number;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function aggregateMetrics(results: EvalResult[]): ProviderMetrics[] {
  const byProvider = new Map<string, EvalResult[]>();
  for (const r of results) {
    const list = byProvider.get(r.provider) ?? [];
    list.push(r);
    byProvider.set(r.provider, list);
  }

  const metrics: ProviderMetrics[] = [];
  for (const [provider, rows] of byProvider) {
    const ok = rows.filter((r) => r.status === "ok");
    const ttft = ok
      .map((r) => r.ttftMs)
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    const total = ok
      .map((r) => r.totalMs)
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);

    metrics.push({
      provider,
      model: rows[0]?.model ?? "",
      n: rows.length,
      answerAccuracy: avg(ok.map((r) => r.answerAccuracy ?? 0)),
      citationAccuracy: avg(ok.map((r) => r.citationAccuracy ?? 0)),
      hallucinationRate: avg(ok.map((r) => r.hallucinationRate ?? 0)),
      retrievalRecallAtK: avg(rows.map((r) => r.retrievalRecallAtK ?? 0)),
      ttftMsP50: percentile(ttft, 50),
      ttftMsP95: percentile(ttft, 95),
      totalMsP50: percentile(total, 50),
      totalMsP95: percentile(total, 95),
      avgPromptTokens: avg(ok.map((r) => r.promptTokens ?? 0)),
      avgCompletionTokens: avg(ok.map((r) => r.completionTokens ?? 0)),
      totalCostUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
      failureRate: rows.filter((r) => r.status !== "ok").length / rows.length,
    });
  }

  return metrics.sort((a, b) => a.provider.localeCompare(b.provider));
}

export { sleep, withBackoff } from "@/lib/util/backoff";
export type { BackoffOptions } from "@/lib/util/backoff";
