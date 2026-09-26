import { spawnSync } from "node:child_process";

function boundedEnv(name: string, fallback: number, maximum: number): string {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return String(fallback);
  return String(Math.min(Math.floor(parsed), maximum));
}

function run(script: string): void {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
    stdio: "inherit",
    env: {
      ...process.env,
      // The final/local enrichment worker must finish a real cycle within the
      // runtime acceptance window. Keep the existing discovery implementation,
      // but bound the expensive public-search fan-out and job-linked fallback.
      PROACTIVE_RECRUITER_MAX_QUERIES: boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 4, 4),
      PROACTIVE_RECRUITER_JOB_LINKED_LIMIT: boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 1),
      PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 2, 2)
    }
  });
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
}

function main(): void {
  run("scripts/proactive-recruiter-once.ts");
  run("scripts/supplement-proactive-recruiters-once.ts");
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ status: "FAILED", feature: "PROACTIVE_RECRUITER_FINAL", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
