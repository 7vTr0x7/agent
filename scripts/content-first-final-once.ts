import { spawnSync } from "node:child_process";

function boundedEnv(name: string, fallback: number, maximum: number): string {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return String(fallback);
  return String(Math.min(Math.floor(parsed), maximum));
}

const result = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "scripts/public-hiring-posts-once.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    // The real recruiter runtime proved that the four-query hiring-post slice
    // yields validated authors/employers. Keep content-first on that same
    // bounded vertical slice instead of expanding into a slower/noisier crawl.
    PUBLIC_HIRING_POST_MAX_QUERIES: boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 4, 4)
  }
});

if (result.status !== 0) {
  throw new Error(`scripts/public-hiring-posts-once.ts failed with exit code ${result.status ?? "unknown"}.`);
}
