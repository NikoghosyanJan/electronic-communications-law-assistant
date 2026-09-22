"use client";

import { useState } from "react";
import { AskTab } from "@/components/AskTab";
import { BenchmarkTab } from "@/components/BenchmarkTab";

type Tab = "ask" | "benchmark";

export default function Home() {
  const [tab, setTab] = useState<Tab>("ask");

  return (
    <div className="ui-shell flex flex-1 flex-col py-8 sm:py-10">
      <header className="mb-8 animate-fade-up">
        <p className="mb-3 text-sm font-semibold tracking-[0.12em] text-[var(--accent)] uppercase">
          Regulatory affairs · Armenia
        </p>
        <h1 className="font-display max-w-3xl text-3xl font-semibold text-[var(--fg)] sm:text-4xl md:text-[2.75rem] md:leading-[1.15]">
          Electronic Communications Law Assistant
        </h1>
        <p className="mt-4 max-w-2xl text-base text-[var(--muted)] sm:text-lg">
          Ask grounded questions in Armenian or English. Compare OpenAI, Gemini,
          Groq, and Grok on the same retrieval pipeline.
        </p>
      </header>

      <div
        className="mb-6 inline-flex w-fit gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-[var(--shadow)]"
        role="tablist"
        aria-label="Main views"
      >
        {(
          [
            ["ask", "Ask"],
            ["benchmark", "Benchmark"],
          ] as const
        ).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`ui-btn min-w-[8.5rem] px-5 py-2.5 text-[0.95rem] ${
                active
                  ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                  : "border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--panel-muted)] hover:text-[var(--fg)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <main className="flex-1 animate-fade-up" key={tab}>
        {tab === "ask" ? <AskTab /> : <BenchmarkTab />}
      </main>

      <footer className="mt-10 border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">
        Assistive only — not legal advice. Citations map to articles of the RA
        Law on Electronic Communications.
      </footer>
    </div>
  );
}
