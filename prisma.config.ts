import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prefer .env.local (Next.js convention); fall back to .env for Prisma CLI.
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Prisma CLI (migrate/db push) must use a direct Neon connection — not the
 * `-pooler` PgBouncer URL. App runtime still uses pooled DATABASE_URL via the
 * Neon adapter in src/lib/db/client.ts.
 */
function resolveMigrateUrl(): string {
  const direct =
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;

  if (!direct) {
    // Allows `prisma generate` before secrets exist.
    return "postgresql://postgres:postgres@localhost:5432/postgres";
  }

  try {
    const url = new URL(direct);
    // Always use the non-pooler host for Prisma CLI — PgBouncer breaks
    // migrate advisory locks (P1002) and is a common cause of P1001 flakes.
    if (url.hostname.includes("-pooler")) {
      url.hostname = url.hostname.replace("-pooler", "");
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "30");
    }
    return url.toString();
  } catch {
    return direct;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveMigrateUrl(),
  },
});
