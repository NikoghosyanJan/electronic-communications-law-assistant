# RA Electronic Communications Law — RAG Assistant

Internal Q&A + multi-LLM benchmark over the [Law of the Republic of Armenia on Electronic Communications](https://www.arlis.am/hy/acts/1869).

Corpus is **local** (`data/law.pdf` provenance + canonical `data/law.md`) — not live-scraped from ARLIS.

## Stack

| Layer | Choice |
|-------|--------|
| App | Next.js 16 (App Router) |
| DB | Neon Postgres + pgvector |
| ORM | Prisma 7 + `@prisma/adapter-neon` |
| Embeddings | OpenAI `text-embedding-3-large` (1536-d) |
| LLMs | OpenAI `gpt-4o-mini`, Gemini `gemini-3.6-flash`, Groq `qwen/qwen3.8-27b`, Grok `grok-4.3` |
| Chunking | Article parent + point/paragraph children; cite article number |

## Setup

1. Copy env and fill keys:

```bash
cp .env.example .env.local
```

Required:

- `DATABASE_URL` — Neon pooled URL (enable **pgvector**)
- `DIRECT_URL` — Neon direct (non-pooler) URL for migrations
- `OPENAI_API_KEY` — embeddings + `gpt-4o-mini` (+ eval judge)
- `GOOGLE_GENERATIVE_AI_API_KEY` — required for Gemini Ask/Benchmark
- `GROQ_API_KEY` — required for Groq Cloud Ask/Benchmark (`qwen/qwen3.8-27b`, console.groq.com; optional `GROQ_MODEL` override)
- `GROK_API_KEY` — required for xAI Grok Ask/Benchmark (console.x.ai)

2. Install, generate Prisma client, migrate:

```bash
npm install
npx prisma generate
npm run db:migrate
# or for a fresh Neon DB: npm run db:push
```

3. Ingest the law (parse → chunk → embed → upsert):

```bash
npm run ingest
# optional: npm run ingest -- --dry-run
```

4. Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — **Ask** and **Benchmark** tabs.

## Demo path (screen recording)

1. `npm run ingest` (if DB empty) → `npm run dev`.
2. **Ask** — Armenian example chip → cited answer; English question → English answer; adversarial chip → refuse.
3. **Benchmark** — open a completed run (or run with all three keys set); show metrics table + one drill-down row; optional **Question subset** for a short demo.
4. Point at [docs/RAG_PIPELINE.pdf](docs/RAG_PIPELINE.pdf) and [docs/EVALUATION_REPORT.pdf](docs/EVALUATION_REPORT.pdf).

### Screen-recording checklist (≤6 min)

- [ ] Walk through Ask: HY question with article citations
- [ ] Ask: EN question (show translation / retrieved articles if useful)
- [ ] Ask: adversarial refuse (no invented facts)
- [ ] Benchmark: metrics table for ≥1 provider; expand one result
- [ ] Briefly show PDF deliverables / recommendation

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run ingest` | Parse `data/law.md` → chunk → embed → Neon |
| `npm run extract-pdf` | Optional: regenerate `data/law.md` from `data/law.pdf` |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate deploy` (with Neon wake retries) |
| `npm run db:push` | `prisma db push` |
| `npm run smoke:benchmark` | Optional small benchmark smoke |

## How it works (short)

1. **Ingest once** — parse articles from `data/law.md`, chunk parent/child, embed with `text-embedding-3-large`, store in Neon pgvector.
2. **Ask** — detect language → hybrid retrieve (vector + keyword, EN→HY translate, confidence gate) → assemble tagged context → generate with chosen provider → cite only retrieved `Հոդված N` / `Article N`.
3. **Benchmark** — same retrieval for all providers on `eval/questions.json` (≥15; HY + EN + adversarial); score with fixed `gpt-4o-mini` judge + heuristics; persist `eval_runs` / `eval_results`; UI streams progress and supports question subsets.

Details: [docs/RAG_PIPELINE.md](docs/RAG_PIPELINE.md).

## Rate limits & retries

Free-tier providers will 429 under a full 20×3+ benchmark. Hardening:

- Shared exponential backoff (`src/lib/util/backoff.ts`) on embeddings, answer generation, and the eval judge.
- Brief pauses between ingest embed batches and between benchmark provider calls.
- Failures are recorded as `rate_limit` / `timeout` / `error` — not silently dropped — so failure rate stays visible in the metrics table.

If a full run stalls on quota, wait for the provider window to reset and re-run (optionally with a subset via **Question subset** in the Benchmark UI / `questionIds` in the API).

## Evaluation

Gold set: [`eval/questions.json`](eval/questions.json) (19 claim-based items: 6 HY + 7 EN answerable incl. multi-article synthesis; 6 adversarial oos / near-miss / underspecified). Each item has atomic `gold_key_points`, `gold_articles`, and `must_not` traps. Self-verified against `data/law.md` (not bar-certified).

Benchmark tab runs each question through the **same retrieval pipeline** for all providers and stores metrics in Neon.

Filled report: [docs/EVALUATION_REPORT.md](docs/EVALUATION_REPORT.md) (+ PDF) from run `cmucogmp4000daym3sge3h36i` (20×3 heuristic). Gold set is now 19 claim-based items — re-run Benchmark for updated numbers; optionally fix `GROK_API_KEY` (xAI console key) to add the Grok column.

## Docs / deliverables

| Artifact | Path |
|----------|------|
| RAG design + code map | [docs/RAG_PIPELINE.md](docs/RAG_PIPELINE.md) · [docs/RAG_PIPELINE.pdf](docs/RAG_PIPELINE.pdf) |
| Eval table + recommendation | [docs/EVALUATION_REPORT.md](docs/EVALUATION_REPORT.md) · [docs/EVALUATION_REPORT.pdf](docs/EVALUATION_REPORT.pdf) |
| Benchmark export (example run) | [docs/benchmark/](docs/benchmark/) |
| Screen recording | ≤6 min (see checklist above) |

Regenerate PDFs:

```bash
cd docs && npx --yes md-to-pdf RAG_PIPELINE.md && npx --yes md-to-pdf EVALUATION_REPORT.md
```

## Project layout

```text
data/law.md · data/law.pdf
prisma/schema.prisma · migrations/
src/app/api/ask · api/benchmark
src/lib/ingest · rag · llm · eval · util/backoff
src/components/AskTab · BenchmarkTab
scripts/ingest.ts · extract-pdf.ts
eval/questions.json
docs/
```

## Security

Do **not** commit API keys. Only [`.env.example`](.env.example) is tracked; `.env*` is gitignored. Keep secrets in `.env.local` only.
