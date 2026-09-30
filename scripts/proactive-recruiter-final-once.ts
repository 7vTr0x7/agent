import { spawnSync } from "node:child_process";

export function boundedEnv(name: string, fallback: number, maximum: number): string {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return String(fallback);
  return String(Math.min(Math.floor(parsed), maximum));
}

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
    PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 4, 4)
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
  // Focus this one-shot on the actual user workflow: public LinkedIn hiring posts ->
  // relevant role/experience/location match -> email extracted from the post ->
  // prepared application message, with live send only when explicit activation flags
  // are enabled in the environment.
  run("scripts/linkedin-hiring-post-once.ts");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ status: "FAILED", feature: "PROACTIVE_RECRUITER_FINAL", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
