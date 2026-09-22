#!/usr/bin/env tsx
/**
 * Neon free-tier computes sleep; first connect can fail with P1001.
 * Also, a hung `migrate` can leave session advisory locks (P1002).
 * Retry with backoff, use a direct (non-pooler) URL via prisma.config.ts,
 * and disable migrate advisory locking which is unreliable on Neon.
 */
import { spawnSync } from "node:child_process";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2000;

function sleepSync(ms: number) {
  spawnSync(
    process.execPath,
    [
      "-e",
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`,
    ],
    { stdio: "ignore" },
  );
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`prisma migrate deploy (attempt ${attempt}/${MAX_ATTEMPTS})…`);
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // Avoid P1002 when a previous migrate session still holds pg_advisory_lock.
      PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
    },
  });

  if (result.status === 0) {
    process.exit(0);
  }

  if (attempt === MAX_ATTEMPTS) {
    process.exit(result.status ?? 1);
  }

  const delay = BASE_DELAY_MS * attempt;
  console.warn(
    `Migrate failed — retrying in ${delay}ms (Neon may be waking up)…`,
  );
  sleepSync(delay);
}
