import { prisma } from "../src/lib/db/client";

const runId = process.argv[2] ?? "cmucogmp4000daym3sge3h36i";

async function main() {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  const n = await prisma.evalResult.count({ where: { runId } });
  const byStatus = await prisma.evalResult.groupBy({
    by: ["provider", "status"],
    where: { runId },
    _count: true,
  });
  console.log(
    JSON.stringify(
      {
        runStatus: run?.status,
        count: n,
        byStatus,
        startedAt: run?.startedAt,
        finishedAt: run?.finishedAt,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
