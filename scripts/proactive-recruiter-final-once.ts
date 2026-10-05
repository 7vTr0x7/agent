import { spawnSync } from "node:child_process";

export function boundedEnv(name: string, fallback: number, maximum: number): string {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return String(fallback);
  return String(Math.min(Math.floor(parsed), maximum));
}

export const FINAL_RUNTIME_SCRIPTS = [
  "scripts/proactive-recruiter-once.ts",
  "scripts/proactive-recruiter-contact-first-once.ts"
] as const;

export function buildRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PROACTIVE_RECRUITER_ENABLED: "true",
    PROACTIVE_RECRUITER_SEND_ENABLED: "false",
    RECRUITER_OUTREACH_DRY_RUN: "true",
    RECRUITER_OUTREACH_ACTIVATION: "disabled",
    RECRUITER_LIVE_ACTIVATION_CONFIRMED: "false",
    AUTOMATION_ENABLED: "false",
    GMAIL_ENABLED: "false",
    OUTBOUND_ENABLED: "false",
    APPLICATION_DRY_RUN: "true",
    APPLICATION_LIVE_ENABLED: "false",
    PROACTIVE_RECRUITER_MAX_QUERIES: boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 2, 2),
    PROACTIVE_RECRUITER_TARGET_CANDIDATES: boundedEnv("PROACTIVE_RECRUITER_TARGET_CANDIDATES", 4, 4),
    PROACTIVE_RECRUITER_SEARCH_PROVIDERS: process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS?.trim() || "qwant-direct,bing-direct",
    PROACTIVE_RECRUITER_JOB_LINKED_LIMIT: boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 1),
    PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 4, 4),
    PROACTIVE_RECRUITER_QUERY_OFFSET: process.env.PROACTIVE_RECRUITER_QUERY_OFFSET ?? "0"
  };
}

function run(script: string): void {
  const result = spawnSync("./node_modules/.bin/tsx", [script], {
    stdio: "inherit",
    env: buildRuntimeEnv()
  });
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
}

function main(): void {
  // P0 discovery must run before contact-first outreach. The latter only
  // processes contacts already persisted by discovery/resource ingestion and
  // cannot replace fresh public recruiter discovery.
  for (const script of FINAL_RUNTIME_SCRIPTS) run(script);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ status: "FAILED", feature: "PROACTIVE_RECRUITER_FINAL", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
