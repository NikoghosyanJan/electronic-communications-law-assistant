"use client";

import { useCallback, useState } from "react";
import type { LlmProviderId } from "@/lib/llm/types";
import { AnswerMarkdown } from "@/components/AnswerMarkdown";
import {
  ArticleViewer,
  type ArticleViewData,
} from "@/components/ArticleViewer";

type ArticleCard = {
  articleNumber: number;
  articleTitle?: string;
  content?: string;
};

type AskResponse = {
  answer?: string;
  citations?: ArticleCard[];
  retrievedArticles?: ArticleCard[];
  meta?: {
    provider: string;
    model: string;
    lang: string;
    usedTranslation: boolean;
    queryUsed?: string;
    lowConfidence?: boolean;
    needsClarification?: boolean;
    ttftMs: number | null;
    totalMs: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    status: string;
    errorMessage?: string;
  };
  error?: string;
};

const PROVIDERS: { id: LlmProviderId; label: string; hint: string }[] = [
  { id: "openai", label: "OpenAI", hint: "gpt-4o-mini" },
  { id: "gemini", label: "Gemini", hint: "3.6 Flash" },
  { id: "groq", label: "Groq", hint: "Qwen3.8 27B" },
  { id: "grok", label: "Grok", hint: "grok-4.3 · xAI" },
];

const EXAMPLES = [
  {
    label: "HY · purposes",
    text: "Որո՞նք են օրենքի նպատակները",
  },
  {
    label: "HY · dominance",
    text: "Ինչպե՞ս է սահմանվում գերիշխող դիրքը",
  },
  {
    label: "EN · regulator",
    text: "What are the Regulator's main functions?",
  },
  {
    label: "Adversarial",
    text: "What is the maximum prison sentence for illegal wiretapping under the Armenian Criminal Code?",
  },
  {
    label: "Underspecified",
    text: "Որոնք են այս հոդվածի հիմնական կետերը։",
  },
];

export function AskTab() {
  const [question, setQuestion] = useState("");
  const [provider, setProvider] = useState<LlmProviderId>("openai");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [openArticle, setOpenArticle] = useState<ArticleViewData | null>(null);

  const closeArticle = useCallback(() => setOpenArticle(null), []);

  function openArticleCard(card: ArticleCard) {
    if (!card.content?.trim()) return;
    setOpenArticle({
      articleNumber: card.articleNumber,
      articleTitle: card.articleTitle,
      content: card.content,
    });
  }

  async function onAsk() {
    setLoading(true);
    setResult(null);
    setOpenArticle(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, provider }),
      });
      const data = (await res.json()) as AskResponse;
      if (!res.ok && !data.error) {
        data.error = `Request failed (${res.status})`;
      }
      setResult(data);
    } catch (err) {
      setResult({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  const hasResult =
    result &&
    (result.answer ||
      result.error ||
      result.meta?.errorMessage ||
      (result.retrievedArticles && result.retrievedArticles.length > 0));

  return (
    <div className="space-y-6">
      <section className="ui-panel space-y-6 p-5 sm:p-7">
        <div>
          <h2 className="font-display text-xl font-semibold sm:text-2xl">
            Ask a question
          </h2>
          <p className="mt-2 text-[var(--muted)]">
            Answers are grounded in retrieved articles of the RA Electronic
            Communications Law. Armenian and English both work.
          </p>
        </div>

        <div>
          <span className="ui-label">Model provider</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup">
            {PROVIDERS.map((p) => {
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setProvider(p.id)}
                  className={`ui-chip justify-between ${active ? "ui-chip-active" : ""}`}
                >
                  <span className="font-semibold text-[var(--fg)]">
                    {p.label}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{p.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="ui-label" htmlFor="ask-question">
            Question
          </label>
          <textarea
            id="ask-question"
            className="ui-textarea"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!loading && question.trim().length >= 3) void onAsk();
              }
            }}
            placeholder="Type in Armenian or English…"
          />
          <p className="mt-2 text-sm text-[var(--muted)]">
            Press ⌘/Ctrl + Enter to submit
          </p>
        </div>

        <div>
          <span className="ui-label">Try an example</span>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.text}
                type="button"
                onClick={() => setQuestion(ex.text)}
                className={`ui-chip ${
                  question === ex.text ? "ui-chip-active" : ""
                }`}
                title={ex.text}
              >
                <span className="truncate">{ex.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => void onAsk()}
            disabled={loading || question.trim().length < 3}
            className="ui-btn ui-btn-primary min-w-[9rem]"
          >
            {loading ? (
              <span className="animate-pulse-soft">Retrieving…</span>
            ) : (
              "Ask"
            )}
          </button>
          {loading ? (
            <span className="text-sm text-[var(--muted)]">
              Embedding · retrieve · generate
            </span>
          ) : null}
        </div>
      </section>

      {result?.error && (
        <div className="ui-alert ui-alert-error animate-fade-up">
          {result.error}
        </div>
      )}

      {hasResult && !result?.error && (
        <section className="ui-panel animate-fade-up space-y-6 p-5 sm:p-7">
          {result?.meta?.status && result.meta.status !== "ok" && (
            <div className="ui-alert ui-alert-warn">
              Generation {result.meta.status}
              {result.meta.errorMessage ? `: ${result.meta.errorMessage}` : ""}
            </div>
          )}

          {result?.answer ? (
            <div>
              <h3 className="ui-label mb-3">Answer</h3>
              <AnswerMarkdown text={result.answer} />
            </div>
          ) : null}

          {result?.citations && result.citations.length > 0 && (
            <div>
              <h3 className="ui-label mb-3">Citations</h3>
              <p className="mb-3 text-sm text-[var(--muted)]">
                Click a citation to read the full article text.
              </p>
              <ul className="flex flex-wrap gap-2">
                {result.citations.map((c) => {
                  const canOpen = Boolean(c.content?.trim());
                  return (
                    <li key={c.articleNumber}>
                      <button
                        type="button"
                        disabled={!canOpen}
                        onClick={() => openArticleCard(c)}
                        className="rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 text-left text-sm font-medium transition hover:border-[var(--accent)] hover:shadow-[var(--shadow)] disabled:cursor-default disabled:opacity-70"
                        title={
                          canOpen
                            ? `Open Հոդված ${c.articleNumber}`
                            : undefined
                        }
                      >
                        Հոդված {c.articleNumber}
                        {c.articleTitle ? (
                          <span className="mt-0.5 block font-normal text-[var(--muted)]">
                            {c.articleTitle}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {result?.retrievedArticles && result.retrievedArticles.length > 0 && (
            <div>
              <h3 className="ui-label mb-3">Related articles</h3>
              <ul className="space-y-2">
                {result.retrievedArticles.map((a) => {
                  const canOpen = Boolean(a.content?.trim());
                  return (
                    <li key={a.articleNumber}>
                      <button
                        type="button"
                        disabled={!canOpen}
                        onClick={() => openArticleCard(a)}
                        className="flex w-full items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-muted)] px-4 py-3 text-left text-[0.95rem] transition hover:border-[var(--accent)] hover:bg-[var(--panel)] disabled:cursor-default disabled:opacity-80"
                        title={
                          canOpen
                            ? `Open Հոդված ${a.articleNumber}`
                            : undefined
                        }
                      >
                        <span>
                          <span className="font-semibold">
                            Հոդված {a.articleNumber}
                          </span>
                          <span className="text-[var(--muted)]">
                            {" "}
                            — {a.articleTitle}
                          </span>
                        </span>
                        {canOpen ? (
                          <span className="shrink-0 text-xs font-semibold tracking-wide text-[var(--accent)] uppercase">
                            View
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {result?.meta && (
            <dl className="grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-5 sm:grid-cols-4">
              {[
                ["Model", result.meta.model],
                [
                  "TTFT / Total",
                  `${result.meta.ttftMs ?? "—"} / ${result.meta.totalMs} ms`,
                ],
                [
                  "Tokens",
                  `${result.meta.promptTokens} + ${result.meta.completionTokens}`,
                ],
                ["Est. cost", `$${result.meta.costUsd.toFixed(6)}`],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl bg-[var(--panel-muted)] px-3 py-3"
                >
                  <dt className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-[var(--fg)]">
                    {value}
                  </dd>
                </div>
              ))}
              {result.meta.usedTranslation && result.meta.queryUsed ? (
                <div className="col-span-2 rounded-xl bg-[var(--panel-muted)] px-3 py-3 sm:col-span-4">
                  <dt className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                    Retrieval query (translated)
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-[var(--fg)]">
                    {result.meta.queryUsed}
                  </dd>
                </div>
              ) : null}
              {result.meta.needsClarification ? (
                <div className="col-span-2 rounded-xl bg-[var(--warn-bg)] px-3 py-3 sm:col-span-4">
                  <dt className="text-xs font-semibold tracking-wide text-[var(--warn)] uppercase">
                    Clarification
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-[var(--warn)]">
                    Question refers to an article without naming which one —
                    asked for article number or topic
                  </dd>
                </div>
              ) : null}
              {result.meta.lowConfidence ? (
                <div className="col-span-2 rounded-xl bg-[var(--warn-bg)] px-3 py-3 sm:col-span-4">
                  <dt className="text-xs font-semibold tracking-wide text-[var(--warn)] uppercase">
                    Retrieval
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-[var(--warn)]">
                    Low confidence — context cleared; model instructed to refuse
                  </dd>
                </div>
              ) : null}
            </dl>
          )}
        </section>
      )}

      <ArticleViewer article={openArticle} onClose={closeArticle} />
    </div>
  );
}
