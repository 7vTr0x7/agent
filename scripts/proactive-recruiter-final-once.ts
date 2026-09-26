import { spawnSync } from "node:child_process";

export function boundedEnv(name: string, fallback: number, maximum: number): string {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return String(fallback);
  return String(Math.min(Math.floor(parsed), maximum));
}

function run(script: string): void {
  const result = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", script], {
    stdio: "inherit",
    env: {
      ...process.env,
      // Keep recruiter discovery bounded while adding public search sources
      // that are materially different from the rate-limited Jina readers.
      // Five providers x four queries remains a small, deterministic fan-out.
      PROACTIVE_RECRUITER_MAX_QUERIES: boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 4, 4),
      PROACTIVE_RECRUITER_TARGET_CANDIDATES: boundedEnv("PROACTIVE_RECRUITER_TARGET_CANDIDATES", 8, 8),
      PROACTIVE_RECRUITER_SEARCH_PROVIDERS: process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS?.trim() || "qwant-direct,yahoo-direct,brave-direct,mojeek-direct,bing-direct",
      PROACTIVE_RECRUITER_JOB_LINKED_LIMIT: boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 2),
      PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 4, 6)
    }
  });
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
}

function main(): void {
  run("scripts/proactive-recruiter-once.ts");
  run("scripts/supplement-proactive-recruiters-once.ts");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ status: "FAILED", feature: "PROACTIVE_RECRUITER_FINAL", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
