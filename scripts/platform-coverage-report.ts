import { Database } from "../src/database/Database";
import { JOB_PLATFORM_REGISTRY } from "../src/jobs/sources/JobPlatformRegistry";

async function main(): Promise<void> {
  const database = new Database(process.env.DATABASE_URL ?? "postgres://job_agent:job_agent@127.0.0.1:5432/job_agent");
  try {
    const latest = await database.query<{
      platform_id: string; platform_name: string; capability: string; outcome: string;
      extraction_mode: string | null; fetched: string; inserted: string; duplicates: string;
      duration_ms: string; completed_at: string; error_detail: string | null;
    }>(
      `SELECT DISTINCT ON (platform_id)
         platform_id,platform_name,capability,outcome,extraction_mode,
         fetched,inserted,duplicates,duration_ms,completed_at,error_detail
       FROM platform_discovery_runs
       ORDER BY platform_id,completed_at DESC`
    );
    const counts = new Map<string, number>();
    for (const platform of JOB_PLATFORM_REGISTRY) counts.set(platform.capability, (counts.get(platform.capability) ?? 0) + 1);
    const attempted = new Set(latest.rows.map((row) => row.platform_id));
    const outcomes = (name: string): number => latest.rows.filter((row) => row.outcome === name).length;
    const produced = latest.rows.filter((row) => Number(row.fetched) > 0).length;
    const duplicates = latest.rows.reduce((sum, row) => sum + Number(row.duplicates), 0);
    const fetched = latest.rows.reduce((sum, row) => sum + Number(row.fetched), 0);
    const inserted = latest.rows.reduce((sum, row) => sum + Number(row.inserted), 0);

    console.log(JSON.stringify({
      registry: {
        total: JOB_PLATFORM_REGISTRY.length,
        activeAdapters: counts.get("active-adapter") ?? 0,
        configurableAdapters: counts.get("configurable-adapter") ?? 0,
        catalogOnly: counts.get("catalog-only") ?? 0,
        executable: JOB_PLATFORM_REGISTRY.filter((p) => p.capability !== "catalog-only").length
      },
      latestRuntime: {
        executed: attempted.size,
        successful: outcomes("SUCCESS_WITH_JOBS") + outcomes("SUCCESS_ZERO_JOBS"),
        failed: latest.rows.length - outcomes("SUCCESS_WITH_JOBS") - outcomes("SUCCESS_ZERO_JOBS") - outcomes("TIMEOUT"),
        timeout: outcomes("TIMEOUT"),
        rateLimited: outcomes("RATE_LIMITED"),
        blocked: outcomes("BLOCKED_OR_RESTRICTED"),
        producedJobs: produced,
        fetched,
        inserted,
        duplicates
      },
      platforms: latest.rows
    }, null, 2));
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
