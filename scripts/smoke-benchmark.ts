/**
 * Smoke: run a tiny subset of the gold set through POST /api/benchmark
 * (heuristic scoring, one provider) against a running Next.js server.
 *
 * Usage:
 *   npm run dev   # elsewhere
 *   npx tsx scripts/smoke-benchmark.ts
 */
const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

async function main() {
  const res = await fetch(`${BASE}/api/benchmark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      useJudge: false,
      providers: ["openai"],
      questionIds: ["en-03", "adv-01"],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Benchmark smoke failed:", data);
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        runId: data.runId,
        resultCount: data.resultCount,
        summary: data.summary,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
