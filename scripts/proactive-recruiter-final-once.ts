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
      // Keep the real discovery path, but cap both the public recruiter search
      // and the hiring-post branch tightly enough to finish inside the local
      // enrichment acceptance window. The discovery service also performs its
      // own hiring-post pass, so a 4-query recruiter cap was still too large.
      PROACTIVE_RECRUITER_MAX_QUERIES: boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 2, 2),
      PROACTIVE_RECRUITER_JOB_LINKED_LIMIT: boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 1),
      PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 1, 1)
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
