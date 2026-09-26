import { spawnSync } from "node:child_process";

export function boundedEnv(name: string, fallback: number, maximum: number): string {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return String(fallback);
  return String(Math.min(Math.floor(parsed), maximum));
}

function run(script: string): void {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
    stdio: "inherit",
    env: {
      ...process.env,
      // Four recruiter queries are the existing bounded product contract. The
      // previous two-query cap was too aggressive: a live Bing response can
      // spend a query on search chrome and return no LinkedIn profile URLs.
      PROACTIVE_RECRUITER_MAX_QUERIES: boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 4, 4),
      PROACTIVE_RECRUITER_JOB_LINKED_LIMIT: boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 1),
      PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 2, 2)
    }
  });
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
}

function main(): void {
  run("scripts/proactive-recruiter-once.ts");
  try {
    run("scripts/supplement-proactive-recruiters-once.ts");
  } catch (error) {
    // Supplement discovery is additive. Keep the primary recruiter cycle
    // successful and expose the secondary failure instead of preventing the
    // contact/content engines from running.
    console.error(JSON.stringify({
      status: "DEGRADED",
      feature: "PROACTIVE_RECRUITER_SUPPLEMENT",
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ status: "FAILED", feature: "PROACTIVE_RECRUITER_FINAL", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
