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
      // Keep the final real-data recruiter slice deterministic and short enough
      // to finish before the local worker command timeout. The hiring-post path
      // already proved it can return identity/evidence-backed recruiter rows.
      PROACTIVE_RECRUITER_MAX_QUERIES: boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 2, 2),
      PROACTIVE_RECRUITER_TARGET_CANDIDATES: boundedEnv("PROACTIVE_RECRUITER_TARGET_CANDIDATES", 4, 4),
      PROACTIVE_RECRUITER_SEARCH_PROVIDERS: process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS?.trim() || "qwant-direct,bing-direct",
      PROACTIVE_RECRUITER_JOB_LINKED_LIMIT: boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 1),
      PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 4, 4)
    }
  });
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
}

function main(): void {
  // The primary path includes bounded hiring-post and job-linked enrichment.
  // The older five-employer supplement duplicated the same public fetch fanout
  // and was the remaining source of the 180s worker timeout, so it is no longer
  // part of the final product once-path.
  run("scripts/proactive-recruiter-once.ts");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ status: "FAILED", feature: "PROACTIVE_RECRUITER_FINAL", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
