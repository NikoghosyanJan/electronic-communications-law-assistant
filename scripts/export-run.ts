import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db/client";
import { aggregateMetrics } from "../src/lib/eval/metrics";

async function main() {
  const runs = await prisma.evalRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, status: true, createdAt: true, notes: true, _count: { select: { results: true } } },
  });
  console.log(JSON.stringify(runs, null, 2));

  const runId = process.argv[2] ?? runs[0]?.id;
  if (!runId) throw new Error("No runs found");

  const run = await prisma.evalRun.findUnique({
    where: { id: runId },
    include: { results: { orderBy: [{ questionId: "asc" }, { provider: "asc" }] } },
  });
  if (!run) throw new Error(`Run ${runId} not found`);

  const summary = (run.summary as unknown) ?? aggregateMetrics(run.results);
  const out = `docs/benchmark/run-${run.id}.json`;
  writeFileSync(out, JSON.stringify({ run, summary }));
  console.log(`Wrote ${out}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
