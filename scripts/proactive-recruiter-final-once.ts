import { spawnSync } from "node:child_process";

function run(script: string): void {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
    stdio: "inherit",
    env: {
      ...process.env,
      // The final/local enrichment worker must finish a real cycle within the
      // runtime acceptance window. Keep the existing discovery implementation,
      // but bound the expensive public-search fan-out and job-linked fallback.
      PROACTIVE_RECRUITER_MAX_QUERIES: process.env.PROACTIVE_RECRUITER_FINAL_MAX_QUERIES ?? "4",
      PROACTIVE_RECRUITER_JOB_LINKED_LIMIT: process.env.PROACTIVE_RECRUITER_FINAL_JOB_LINKED_LIMIT ?? "1"
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
