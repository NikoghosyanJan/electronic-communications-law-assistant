# Evaluation Report

**System:** RA Electronic Communications Law RAG assistant  
**Providers compared:** OpenAI `gpt-4o-mini`, Google Gemini `gemini-3.6-flash`, Groq `qwen/qwen3.8-27b` (xAI Grok `grok-4.3` configured but invalid API key — excluded from this run)  
**Shared pipeline:** article-aware chunking · OpenAI `text-embedding-3-large` (1536) · Neon pgvector · grounded prompt · confidence gate · citation filter · Groq context/`max_tokens` budget for free-tier TPM  
**Gold set:** `eval/questions.json` (19 claim-based items: 6 HY + 7 EN answerable incl. synthesis; 6 adversarial oos / near-miss / underspecified). Atomic `gold_key_points` + `must_not`; self-verified against `data/law.md` (not bar-certified).
**Scoring:** fixed `gpt-4o-mini` LLM judge on top of the heuristic claim match + `must_not` checks (answer accuracy and hallucination rate are judge-refined; citation accuracy and Recall@k are deterministic)

---

## 1. Benchmark results (per model)

| Metric | OpenAI gpt-4o-mini | Gemini 3.6 Flash | Groq Qwen3.8-27B | Grok grok-4.3 |
|--------|--------------------|------------------|-------------------|--------------------|
| Answer accuracy (mean) | 96.1% | 95.8%* | 89.5% | — (invalid key) |
| Citation accuracy (mean) | 94.7% | 70.0%* | 61.8% | — |
| Hallucination rate (mean) | 5.0% | 6.7%* | 9.6% | — |
| Retrieval Recall@k (shared) | 94.7%† | 94.7%† | 94.7%† | — |
| TTFT p50 / p95 (ms) | 797 / 2711 | 4373 / 10764 | 29985 / 33759 | — |
| Total latency p50 / p95 (ms) | 1735 / 4265 | 4933 / 11086 | 30326 / 35532 | — |
| Avg prompt + completion tokens | 3299 + 94 | 5491 + 176 | 5085 + 320 | — |
| Est. cost @ paid rates (USD, full run) | $0.0105 | $0.0717 | $0.1016 | — |
| Failure rate (rate limit / timeout / malformed) | 0% | 21.1% | 0% | — |

\* Gemini accuracy / citation / hallucination averages are over **successful** completions only; 4/19 calls failed (all `503 Service Unavailable` from the Gemini API, recorded as `error`: en-04, en-07, hy-02, hy-03).  
† Shared retrieval; adversarial items with empty `gold_articles` count as perfect recall. On **answerable** items only, Recall@k ≈ **92.3%** (12/13 — only hy-02 misses Art. 17).

**Run id:** `cmuf7bi4d0000jdtyrtdc8yc4`  
**Date:** 2026-09-24  
**Raw export:** [`docs/benchmark/run-cmuf7bi4d0000jdtyrtdc8yc4.json`](benchmark/run-cmuf7bi4d0000jdtyrtdc8yc4.json)

### Slice highlights

| Slice | OpenAI ans / cite / hall | Gemini ans / cite / hall (fail) | Groq ans / cite / hall |
|-------|--------------------------|----------------------------------|-------------------------|
| Armenian answerable (6) | 87.5% / 83.3% / 12.5% | 100% / 100% / 0% (33% fail) | 75.0% / 70.8% / 12.5% |
| English answerable (7) | 100% / 100% / 2.9% | 87.5% / 90.0% / 20.0% (29% fail) | 92.9% / 78.6% / 15.4% |
| Adversarial (6) | 100% / 100% / 0% | 100% / 33.3% / 0% (0% fail) | 100% / 33.3% / 0% |

All three models refuse / clarify correctly on every adversarial item. The difference is citation discipline: Gemini and Groq still attach retrieved article numbers to their refusals on adv-02…05 (gold expects none), so their adversarial citation accuracy drops to 33%; OpenAI cites nothing on those items. Gemini's perfect Armenian slice is over only 4 completed items — both failed HY calls (hy-02, hy-03) include the hardest retrieval case. The hardest items for everyone are hy-02 (retrieval miss on Art. 17) and hy-06 (Art. 2 definitions retrieved last, behind Arts 59 / 31 / 53).

### How metrics are computed

| Metric | Method |
|--------|--------|
| Answer accuracy | Claim coverage vs atomic `gold_key_points`, refined by the `gpt-4o-mini` judge; adversarial = refuse / clarify by subtype |
| Citation accuracy | Precision of cited article numbers vs `gold_articles` (adversarial: empty citations score 1) |
| Hallucination rate | Citations outside retrieved set and/or `must_not` trap hits, refined by the judge for unsupported claims in prose |
| Latency | Streaming TTFT + total wall time per completion |
| Cost | Tokens × public paid list prices in `src/lib/llm/pricing.ts` |
| Failure rate | `status ≠ ok` (rate_limit / timeout / malformed / error) |

---

## 2. Recommendation

**Recommended default for production standardization: OpenAI `gpt-4o-mini`.**

Reasons (tied to this run):

1. **Best reliability** — 0% failure across all 19 questions; Gemini lost 21% of calls to upstream 503s.
2. **Best citation discipline** — 94.7% citation accuracy overall and 100% on adversarial items (no article cites on refusals), versus 70% (Gemini) and 62% (Groq). This matters most for a legal desk tool.
3. **Best latency / cost** — TTFT p50 ~0.8s, total p50 ~1.7s; ~$0.01 for the full 19×1 eval at paid rates vs ~$0.07–$0.10 for Gemini/Groq.
4. **Top answer accuracy** — 96.1% overall, level with Gemini's successful-call average (95.8%) and ahead of Groq (89.5%), with the lowest hallucination rate (5.0%).

**When to prefer another model:**

- **Gemini Flash** — matches OpenAI on answer accuracy when it completes and was perfect on the Armenian items it finished; not yet reliable enough (21% failures) for a full desk load, and it cites articles on refusals.
- **Groq Qwen** — no failures, but ~30s p50 latency and the weakest citation / hallucination numbers; only suitable for offline batch work with citation filtering on.
- **Grok** — re-test after installing a valid `GROK_API_KEY` from [console.x.ai](https://console.x.ai) (do not reuse a Groq `gsk_` key).

**Caveats:**

- The judge is `gpt-4o-mini`, the same model as the recommended provider, so answer accuracy / hallucination may carry some preference toward OpenAI-style answers. Citation accuracy, Recall@k, latency, cost and failure rate are deterministic and not affected; OpenAI also led on answer accuracy in the previous heuristic-only run.
- Retrieval is no longer the main cap (answerable Recall@k 92.3%); remaining errors are mostly citation precision and ranking (hy-06).
- Groq free-tier TPM (~8k) requires capped `max_tokens` and truncated context (`src/lib/llm/groq.ts`, `src/lib/rag/generate.ts`).

---

## 3. Trade-offs

### Latency vs accuracy

- OpenAI wins the interactive Ask path (sub‑2s p50, ~4s p95) and is also the most accurate in this run.
- Groq is the slowest by far (~30s p50 TTFT, thinking-style completions) without an accuracy advantage.
- Gemini sits in the middle on latency (~5s p50) when healthy, but upstream 503s dominate its failure rate.

### Armenian language handling

- Corpus is Armenian-only; EN questions use multilingual embeddings + **always-on EN→HY query translation** with a statutory glossary (`src/lib/rag/retrieve.ts`).
- Generation language follows the question (`src/lib/rag/language.ts`).
- In this run the **Armenian** slice is now the harder one: EN answerable retrieval is 100% (7/7), HY answerable is 83% (5/6). OpenAI scores 87.5% on HY vs 100% on EN; Groq 75% vs 93%.

### Rate-limit reliability

- Generation, embeddings, and the optional judge use exponential backoff (`src/lib/util/backoff.ts`).
- Gemini: non-streaming fallback after intermittent stream parse failures (`src/lib/llm/gemini.ts`). This run's failures were upstream `503` errors, not free-tier 429s.
- Groq: `max_tokens=768` + ~8k-char context budget so free-tier TPM does not 413 on declared ceilings.
- Failures are recorded per result (not silently dropped).

---

## 4. Known limitations

- Single law / single jurisdiction; no multi-document routing.
- PDF/ARLIS extract may miss amendment nuance if `law.md` is stale vs latest incorporation.
- Parent chunk embeddings truncate very long articles (~2500 chars of body); children mitigate but parent-only hits can be incomplete.
- Distance-based confidence gate helps only for *weak* neighbors; near-topic adversarials still retrieve related articles — refusal relies on the generator, and some generators still cite those articles.
- Soft grounding: citation **cards** are filtered to the retrieved set; answer prose is prompt-only.
- Provider availability (Gemini 503s) and invalid keys (Grok) can dominate failure rate unrelated to model quality.
- Judge and recommended provider are the same model family (see caveats in §2).
- No human legal review loop; outputs are assistive, not advice.

---

## 5. What we would do with more time

- Install a valid xAI Grok key and complete the fourth column.
- Use a judge from a different provider (or a panel) to remove self-preference risk.
- Try **BGE-M3** or Cohere multilingual embeddings; fix the remaining HY retrieval miss (hy-02 → Art. 17) and ranking of definitions (hy-06 → Art. 2).
- Stronger hybrid retrieval (BM25 / Postgres FTS on Armenian stems + vectors).
- Structured citation JSON schema / constrained decoding per provider; drop citations on refusals.
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

1. Gemini / Groq / OpenAI keys were set; Grok key still invalid.
2. Benchmark tab → OpenAI + Gemini + Groq → Run (judge) on the 19-item claim-based gold set produced run `cmuf7bi4d0000jdtyrtdc8yc4` (2026-09-24, ~13 min).
3. Previous run `cmucogmp4000daym3sge3h36i` (20 items, old gold wording, heuristic only) is kept in `docs/benchmark/` for reference; its numbers are not comparable to this run.
