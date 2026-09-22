"use client";

import { Fragment, useEffect, useState } from "react";
import type { LlmProviderId } from "@/lib/llm/types";
import { AnswerMarkdown } from "@/components/AnswerMarkdown";

type ProviderMetrics = {
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

type RunSummary = {
  id: string;
  status: string;
  createdAt: string;
  notes: string | null;
  summary: ProviderMetrics[] | null;
  _count?: { results: number };
};

type ResultRow = {
  id: string;
  questionId: string;
  provider: string;
  model: string;
  lang: string;
  questionType: string;
  question: string;
  answer: string | null;
  citations: number[] | null;
  retrievedArticles: number[] | null;
  goldArticles: number[] | null;
  answerAccuracy: number | null;
  citationAccuracy: number | null;
  hallucinationRate: number | null;
  retrievalRecallAtK: number | null;
  ttftMs: number | null;
  totalMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  status: string;
  errorMessage: string | null;
  judgeNotes: string | null;
};

type GoldMeta = {
  id: string;
  lang: string;
  type: string;
  question: string;
};

const PROVIDER_OPTIONS: { id: LlmProviderId; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "groq", label: "Groq" },
  { id: "grok", label: "Grok (xAI)" },
];

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function asNums(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((n): n is number => typeof n === "number");
}

export function BenchmarkTab() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProviderMetrics[] | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [useJudge, setUseJudge] = useState(true);
  const [selectedProviders, setSelectedProviders] = useState<LlmProviderId[]>([
    "openai",
    "gemini",
    "groq",
    "grok",
  ]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<GoldMeta[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [showSubset, setShowSubset] = useState(false);

  async function loadRuns() {
    const res = await fetch("/api/benchmark/results");
    const data = await res.json();
    if (data.runs) setRuns(data.runs);
  }

  async function loadQuestions() {
    const res = await fetch("/api/benchmark");
    const data = await res.json();
    if (data.questions) {
      const qs = data.questions as GoldMeta[];
      setQuestions(qs);
      setSelectedQuestionIds(qs.map((q) => q.id));
    }
  }

  async function loadRun(runId: string) {
    setActiveRunId(runId);
    setExpandedId(null);
    const res = await fetch(`/api/benchmark/results?runId=${runId}`);
    const data = await res.json();
    if (data.error) {
      setError(data.error);
      return;
    }
    setSummary((data.summary as ProviderMetrics[]) ?? null);
    setResults((data.run?.results as ResultRow[]) ?? []);
  }

  useEffect(() => {
    void loadRuns();
    void loadQuestions();
  }, []);

  function toggleProvider(id: LlmProviderId) {
    setSelectedProviders((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  }

  function toggleQuestion(id: string) {
    setSelectedQuestionIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((q) => q !== id);
      }
      return [...prev, id];
    });
  }

  function selectAllQuestions() {
    setSelectedQuestionIds(questions.map((q) => q.id));
  }

  function selectSlice(type: "hy" | "en" | "adversarial") {
    setSelectedQuestionIds(
      questions
        .filter((q) =>
          type === "adversarial" ? q.type === "adversarial" : q.lang === type,
        )
        .map((q) => q.id),
    );
  }

  async function onRun() {
    setRunning(true);
    setError(null);
    setProgress("Starting…");
    try {
      const allSelected =
        questions.length > 0 &&
        selectedQuestionIds.length === questions.length;
      const res = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useJudge,
          providers: selectedProviders,
          stream: true,
          ...(allSelected ? {} : { questionIds: selectedQuestionIds }),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ||
            `Benchmark failed (${res.status})`,
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let donePayload: {
        runId?: string;
        summary?: ProviderMetrics[];
      } | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            step?: number;
            total?: number;
            questionId?: string;
            provider?: string;
            runId?: string;
            summary?: ProviderMetrics[];
            error?: string;
          };
          if (event.type === "progress") {
            setProgress(
              `Step ${event.step}/${event.total}: ${event.questionId} · ${event.provider}`,
            );
          } else if (event.type === "done") {
            donePayload = event;
            setProgress(null);
          } else if (event.type === "error") {
            throw new Error(event.error || "Benchmark failed");
          }
        }
      }

      if (!donePayload?.runId) {
        throw new Error("Benchmark stream ended without results");
      }
      setSummary(donePayload.summary ?? null);
      await loadRuns();
      await loadRun(donePayload.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setRunning(false);
    }
  }

  function exportJson() {
    const blob = new Blob(
      [JSON.stringify({ runId: activeRunId, summary, results }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark-${activeRunId ?? "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const stepEstimate = selectedQuestionIds.length * selectedProviders.length;

  return (
    <div className="space-y-6">
      <section className="ui-panel space-y-6 p-5 sm:p-7">
        <div>
          <h2 className="font-display text-xl font-semibold sm:text-2xl">
            Benchmark providers
          </h2>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            Runs the gold set (<code className="rounded bg-[var(--panel-muted)] px-1.5 py-0.5 text-[0.9em]">eval/questions.json</code>, 19
            items: 6 HY + 7 EN answerable incl. multi-article synthesis, 6 adversarial
            oos / near-miss / underspecified) through the same RAG pipeline.
            Collects answer / citation accuracy, hallucinations, Recall@k,
            latency, tokens, cost, and failures.
          </p>
        </div>

        <div>
          <span className="ui-label">Providers</span>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_OPTIONS.map((p) => {
              const active = selectedProviders.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProvider(p.id)}
                  disabled={running}
                  className={`ui-chip ${active ? "ui-chip-active" : ""}`}
                  aria-pressed={active}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <label className="ui-check">
            <input
              type="checkbox"
              checked={useJudge}
              onChange={(e) => setUseJudge(e.target.checked)}
              disabled={running}
            />
            LLM judge (gpt-4o-mini)
          </label>
          <label className="ui-check">
            <input
              type="checkbox"
              checked={showSubset}
              onChange={(e) => setShowSubset(e.target.checked)}
              disabled={running}
            />
            Question subset
          </label>
        </div>

        {showSubset && questions.length > 0 && (
          <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-muted)] p-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["All", selectAllQuestions],
                  ["Armenian", () => selectSlice("hy")],
                  ["English", () => selectSlice("en")],
                  ["Adversarial", () => selectSlice("adversarial")],
                ] as const
              ).map(([label, fn]) => (
                <button
                  key={label}
                  type="button"
                  className="ui-btn ui-btn-secondary px-3 py-2 text-sm"
                  onClick={fn}
                  disabled={running}
                >
                  {label}
                  {label === "All" ? ` (${questions.length})` : ""}
                </button>
              ))}
            </div>
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {questions.map((q) => (
                <li key={q.id}>
                  <label className="ui-check items-start rounded-xl border border-transparent px-2 py-2 hover:border-[var(--border)] hover:bg-[var(--panel)]">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedQuestionIds.includes(q.id)}
                      onChange={() => toggleQuestion(q.id)}
                      disabled={running}
                    />
                    <span>
                      <span className="font-semibold">{q.id}</span>{" "}
                      <span className="text-[var(--muted)]">
                        ({q.lang}/{q.type})
                      </span>
                      <span className="mt-0.5 block text-sm text-[var(--muted)]">
                        {q.question.slice(0, 100)}
                        {q.question.length > 100 ? "…" : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void onRun()}
            disabled={
              running ||
              selectedProviders.length === 0 ||
              selectedQuestionIds.length === 0
            }
            className="ui-btn ui-btn-primary"
          >
            {running ? (
              <span className="animate-pulse-soft">Running…</span>
            ) : (
              `Run benchmark (${stepEstimate} steps)`
            )}
          </button>
          <button
            type="button"
            onClick={() => void loadRuns()}
            className="ui-btn ui-btn-secondary"
          >
            Refresh runs
          </button>
          {results.length > 0 && (
            <button
              type="button"
              onClick={exportJson}
              className="ui-btn ui-btn-secondary"
            >
              Export JSON
            </button>
          )}
        </div>

        {progress && (
          <div className="ui-alert ui-alert-info animate-pulse-soft">
            {progress}
          </div>
        )}

        {error && <div className="ui-alert ui-alert-error">{error}</div>}
      </section>

      {runs.length > 0 && (
        <section className="ui-panel p-5 sm:p-7">
          <h3 className="font-display mb-4 text-lg font-semibold">
            Previous runs
          </h3>
          <ul className="space-y-2">
            {runs.map((r) => {
              const active = activeRunId === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)] bg-[var(--panel-muted)] hover:border-[var(--border-strong)] hover:bg-[var(--panel)]"
                    }`}
                    onClick={() => void loadRun(r.id)}
                  >
                    <span className="font-semibold">
                      {r.id.slice(0, 8)}… — {r.status}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--muted)]">
                      {r._count ? `${r._count.results} results` : ""}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {summary && summary.length > 0 && (
        <section className="ui-panel overflow-hidden p-0">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-7">
            <h3 className="font-display text-lg font-semibold">
              Metrics by provider
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="ui-table min-w-[880px]">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Answer</th>
                  <th>Citation</th>
                  <th>Halluc.</th>
                  <th>Recall@k</th>
                  <th>TTFT p50/p95</th>
                  <th>Total p50/p95</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                  <th>Fail %</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((m) => (
                  <tr key={m.provider}>
                    <td>
                      <div className="font-semibold capitalize">{m.provider}</div>
                      <div className="text-sm text-[var(--muted)]">{m.model}</div>
                    </td>
                    <td>{pct(m.answerAccuracy)}</td>
                    <td>{pct(m.citationAccuracy)}</td>
                    <td>{pct(m.hallucinationRate)}</td>
                    <td>{pct(m.retrievalRecallAtK)}</td>
                    <td>
                      {m.ttftMsP50 ?? "—"}/{m.ttftMsP95 ?? "—"}
                    </td>
                    <td>
                      {m.totalMsP50 ?? "—"}/{m.totalMsP95 ?? "—"}
                    </td>
                    <td>
                      {m.avgPromptTokens.toFixed(0)}+
                      {m.avgCompletionTokens.toFixed(0)}
                    </td>
                    <td>${m.totalCostUsd.toFixed(4)}</td>
                    <td>{pct(m.failureRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section className="ui-panel overflow-hidden p-0">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-7">
            <h3 className="font-display text-lg font-semibold">Drill-down</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="ui-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Q</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Ans</th>
                  <th>Cite</th>
                  <th>Hall</th>
                  <th>Recall</th>
                  <th>ms</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const open = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="cursor-pointer text-left font-semibold text-[var(--accent)] hover:underline"
                            onClick={() => setExpandedId(open ? null : r.id)}
                          >
                            {r.questionId}
                          </button>
                          <div className="text-sm text-[var(--muted)]">
                            {r.lang}/{r.questionType}
                          </div>
                        </td>
                        <td className="capitalize">{r.provider}</td>
                        <td>{r.status}</td>
                        <td>{pct(r.answerAccuracy)}</td>
                        <td>{pct(r.citationAccuracy)}</td>
                        <td>{pct(r.hallucinationRate)}</td>
                        <td>{pct(r.retrievalRecallAtK)}</td>
                        <td>{r.totalMs ?? "—"}</td>
                        <td className="max-w-xs text-[var(--muted)]">
                          {(r.answer ?? r.errorMessage ?? r.question).slice(
                            0,
                            140,
                          )}
                          …
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td
                            colSpan={9}
                            className="space-y-3 bg-[var(--panel-muted)] p-5 text-[0.95rem]"
                          >
                            <p>
                              <span className="font-semibold">Question: </span>
                              {r.question}
                            </p>
                            {r.answer && (
                              <div>
                                <span className="font-semibold">Answer: </span>
                                <AnswerMarkdown
                                  className="mt-2"
                                  text={r.answer}
                                />
                              </div>
                            )}
                            {r.errorMessage && (
                              <p className="text-[var(--danger)]">
                                <span className="font-semibold">Error: </span>
                                {r.errorMessage}
                              </p>
                            )}
                            <p className="text-[var(--muted)]">
                              Gold articles:{" "}
                              {asNums(r.goldArticles).join(", ") || "—"} ·
                              Retrieved:{" "}
                              {asNums(r.retrievedArticles).join(", ") || "—"} ·
                              Cited: {asNums(r.citations).join(", ") || "—"}
                              {r.costUsd != null
                                ? ` · $${r.costUsd.toFixed(6)}`
                                : ""}
                              {r.promptTokens != null
                                ? ` · tokens ${r.promptTokens}+${r.completionTokens ?? 0}`
                                : ""}
                            </p>
                            {r.judgeNotes && (
                              <p className="text-[var(--muted)]">
                                <span className="font-semibold">Judge: </span>
                                {r.judgeNotes}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
