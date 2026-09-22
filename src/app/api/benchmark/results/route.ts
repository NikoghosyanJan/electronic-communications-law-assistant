import { prisma } from "@/lib/db/client";
import { aggregateMetrics } from "@/lib/eval/metrics";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const runId = url.searchParams.get("runId");

    if (runId) {
      const run = await prisma.evalRun.findUnique({
        where: { id: runId },
        include: { results: { orderBy: [{ questionId: "asc" }, { provider: "asc" }] } },
      });
      if (!run) {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      const summary = (run.summary as unknown) ?? aggregateMetrics(run.results);
      return Response.json({ run, summary });
    }

    const runs = await prisma.evalRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        summary: true,
        createdAt: true,
        notes: true,
        _count: { select: { results: true } },
      },
    });

    return Response.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
