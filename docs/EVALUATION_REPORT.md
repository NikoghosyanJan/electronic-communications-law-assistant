# Evaluation Report

**System:** RA Electronic Communications Law RAG assistant  
**Providers compared:** OpenAI `gpt-4o-mini`, Google Gemini `gemini-3.6-flash`, Groq `qwen/qwen3.8-27b` (xAI Grok `grok-4.3` configured but invalid API key — excluded from this run)  
**Shared pipeline:** article-aware chunking · OpenAI `text-embedding-3-large` (1536) · Neon pgvector · grounded prompt · confidence gate · citation filter · Groq context/`max_tokens` budget for free-tier TPM  
**Gold set:** `eval/questions.json` (19 claim-based items: 6 HY + 7 EN answerable incl. synthesis; 6 adversarial oos / near-miss / underspecified). Atomic `gold_key_points` + `must_not`; self-verified against `data/law.md` (not bar-certified).
**Scoring:** heuristic claim match + must_not (no LLM judge in this run) so provider comparison is not biased toward OpenAI-style answers

> **Note:** The numbers in §1 below are from run `cmucogmp4000daym3sge3h36i` on the **previous** gold wording. Re-run Benchmark after the claim-based rewrite before treating the table as final.

---

## 1. Benchmark results (per model)

| Metric | OpenAI gpt-4o-mini | Gemini 3.6 Flash | Groq Qwen3.8-27B | Grok grok-4.3 |
|--------|--------------------|------------------|-------------------|--------------------|
| Answer accuracy (mean) | 82.9% | 83.0%* | 90.4% | — (invalid key) |
| Citation accuracy (mean) | 85.0% | 73.8%* | 56.3% | — |
| Hallucination rate (mean) | 0.5% | 0.7%* | 0.5% | — |
| Retrieval Recall@k (shared) | 80.0%† | 80.0%† | 80.0%† | — |
| TTFT p50 / p95 (ms) | 1083 / 2004 | 7609 / 13653 | 21000 / 73459 | — |
| Total latency p50 / p95 (ms) | 2227 / 5025 | 8470 / 16455 | 19026 / 69022 | — |
| Avg prompt + completion tokens | 3019 + 132 | 4718 + 306 | 4610 + 359 | — |
| Est. cost @ paid rates (USD, full run) | $0.0106 | $0.0656 | $0.1025 | — |
| Failure rate (rate limit / timeout / malformed) | 0% | 30.0% | 0% | — |

\* Gemini accuracy / citation / hallucination averages are over **successful** completions only; 6/20 calls failed (5× `rate_limit`, 1× stream/`error`).  
† Shared retrieval; adversarial items with empty `gold_articles` count as perfect recall. On **answerable** items only, Recall@k ≈ **71.4%**.

**Run id:** `cmucogmp4000daym3sge3h36i`  
**Date:** 2026-09-22  
**Raw export:** [`docs/benchmark/run-cmucogmp4000daym3sge3h36i.json`](benchmark/run-cmucogmp4000daym3sge3h36i.json)

### Slice highlights

| Slice | OpenAI ans / cite / hall | Gemini ans / cite / hall (fail) | Groq ans / cite / hall |
|-------|--------------------------|----------------------------------|-------------------------|
| Armenian answerable (7) | 75.8% / 100% / 0% | 89.7% / 88.9% / 0% (14% fail) | 92.0% / 75.0% / 0% |
| English answerable (7) | 75.5% / 57.1% / 1.4% | 70.6% / 50.0% / 1.7% (14% fail) | 80.5% / 42.9% / 1.4% |
| Adversarial (6) | 100% / 100% / 0% | 100% / 100% / 0% (**67% fail**) | 100% / 50.0% / 0% |

Adversarial refusals are strong when the model completes (especially OpenAI). Groq’s lower citation accuracy on adversarial items reflects occasional article cites when the gold expects none. Answerable accuracy is still capped by retrieval (~71% Recall@k on answerable).

### How metrics are computed

| Metric | Method |
|--------|--------|
| Answer accuracy | Claim coverage vs atomic `gold_key_points` (≥60% claim-token hit); adversarial = refuse / clarify by subtype (optional LLM judge in UI) |
| Citation accuracy | Precision of cited article numbers vs `gold_articles` (adversarial: empty citations score 1) |
| Hallucination rate | Citations outside retrieved set and/or `must_not` trap hits |
| Latency | Streaming TTFT + total wall time per completion |
| Cost | Tokens × public paid list prices in `src/lib/llm/pricing.ts` |
| Failure rate | `status ≠ ok` (rate_limit / timeout / malformed / error) |

---

## 2. Recommendation

**Recommended default for production standardization: OpenAI `gpt-4o-mini`.**

Reasons (tied to this run):

1. **Best reliability** — 0% failure across all 20 questions; Gemini lost 30% of calls to free-tier rate limits / errors.
2. **Best citation discipline** — 85% citation accuracy overall; perfect adversarial citation behavior (critical for a legal desk tool). Groq’s higher answer-accuracy score comes with weaker citation precision (56%).
3. **Best latency / cost** — TTFT p50 ~1.1s, total p50 ~2.2s; ~$0.01 for the full 20×1 eval at paid rates vs ~$0.07–$0.10 for Gemini/Groq.
4. **Strong enough answer accuracy** — ~83% overall (heuristic), matching Gemini’s successful-call average and trailing Groq’s ~90% — but Groq’s p50 latency (~19–21s) is unsuitable for interactive Ask.

**When to prefer another model:**

- **Groq Qwen** — if batch / offline analysis prioritizes answer-key coverage over citation precision and latency; keep citation filtering on.
- **Gemini Flash** — competitive when it completes, especially on Armenian answerable; not yet reliable enough on free-tier quota for a full desk load.
- **Grok** — re-test after installing a valid `GROK_API_KEY` from [console.x.ai](https://console.x.ai) (do not reuse a Groq `gsk_` key).

**Caveats:**

- This table used **heuristic** scoring (not the OpenAI judge) to avoid preference risk.
- Improving **retrieval Recall@k** will raise answer accuracy more than swapping chat models.
- Groq free-tier TPM (~8k) requires capped `max_tokens` and truncated context (`src/lib/llm/groq.ts`, `src/lib/rag/generate.ts`).

---

## 3. Trade-offs

### Latency vs accuracy

- OpenAI wins the interactive Ask path (sub‑3s typical).
- Groq posts the highest heuristic answer accuracy but with multi‑tens-of-seconds latency (thinking-style completions).
- Gemini sits in the middle on latency when healthy, but free-tier 429s dominate failure rate.

### Armenian language handling

- Corpus is Armenian-only; EN questions use multilingual embeddings + **always-on EN→HY query translation** with a statutory glossary (`src/lib/rag/retrieve.ts`).
- Generation language follows the question (`src/lib/rag/language.ts`).
- HY answerable accuracy is strong across providers (OpenAI 76%, Gemini ~90% when successful, Groq 92%); EN citation precision remains the weaker slice.

### Rate-limit reliability

- Generation, embeddings, and the optional judge use exponential backoff (`src/lib/util/backoff.ts`).
- Gemini: non-streaming fallback after intermittent stream parse failures (`src/lib/llm/gemini.ts`).
- Groq: `max_tokens=768` + ~8k-char context budget so free-tier TPM does not 413 on declared ceilings.
- Failures are recorded per result (not silently dropped).

---

## 4. Known limitations

- Single law / single jurisdiction; no multi-document routing.
- PDF/ARLIS extract may miss amendment nuance if `law.md` is stale vs latest incorporation.
- Parent chunk embeddings truncate very long articles (~2500 chars of body); children mitigate but parent-only hits can be incomplete.
- Distance-based confidence gate helps only for *weak* neighbors; near-topic adversarials still retrieve related articles — refusal relies on the generator.
- Soft grounding: citation **cards** are filtered to the retrieved set; answer prose is prompt-only.
- Free-tier quotas (Gemini) and invalid keys (Grok) can dominate failure rate unrelated to model quality.
- No human legal review loop; outputs are assistive, not advice.
- Shared Recall@k on answerable items (~71%) still caps achievable answer accuracy.

---

## 5. What we would do with more time

- Install a valid xAI Grok key and complete the fourth column.
- Try **BGE-M3** or Cohere multilingual embeddings; measure Recall@k on the gold set.
- Stronger hybrid retrieval (BM25 / Postgres FTS on Armenian stems + vectors).
- Structured citation JSON schema / constrained decoding per provider.
- Lawyer review of the claim-based gold set; separate HY-only and EN-only leaderboards.
- Persistent caching of embeddings and retrieval for Ask UI.
- UI: article deep-links into `law.md` offsets; export signed PDF memos.

---

## Appendix — gold set coverage (claim-based, article-verified)

| Slice | Count | IDs / articles |
|-------|------:|----------------|
| Armenian answerable | 6 | hy-01…06 → Arts **30, 17, 33, 22–23, 45, 2** |
| English answerable | 7 | en-01…07 → Arts **3, 26, 13, 48, 39, 40, 27** |
| Adversarial | 6 | adv-01…03 oos · adv-04…05 near_miss · adv-06 underspecified |
| **Total** | **19** | |

Claims and citations checked against `data/law.md` (ARLIS extract). Not bar-certified.

### Ops notes (this run)

1. Gemini / Groq / OpenAI keys were set; Grok key returned `Incorrect API key` from xAI.
2. Groq free-tier 413s were fixed by capping `max_tokens` and truncating context before the full 20×3 run.
3. Benchmark tab → OpenAI + Gemini + Groq → Run (heuristic) produced run `cmucogmp4000daym3sge3h36i`.
