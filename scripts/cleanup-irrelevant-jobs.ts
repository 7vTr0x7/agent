import fs from "node:fs/promises";
import path from "node:path";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { loadJobSearchPolicy } from "../src/jobs/policy/loadJobSearchPolicy";
import { evaluateJobEligibility } from "../src/jobs/policy/JobEligibility";

interface OpportunityRow {
  id: string;
  canonical_url: string;
  title: string;
  company_name: string;
  location: string | null;
  country: string | null;
  workplace_type: "onsite" | "remote" | "hybrid" | null;
  description: string;
  posted_at: string | null;
}

function hasFlag(flag: string): boolean { return process.argv.includes(flag); }
function valueFlag(prefix: string): string | undefined {
  const item = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return item?.slice(prefix.length + 1) || undefined;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const apply = hasFlag("--apply");
  const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved");
  const policy = loadJobSearchPolicy(profile);
  const database = new Database(databaseUrl);

  try {
    const rows = await database.query<OpportunityRow>(
      `SELECT id, canonical_url, title, company_name, location, country, workplace_type, description, posted_at
       FROM job_opportunities
       WHERE status <> 'CLOSED'
       ORDER BY created_at ASC`
    );

    const keep: OpportunityRow[] = [];
    const remove: OpportunityRow[] = [];
    const reasons: Record<string, number> = {};
    for (const row of rows.rows) {
      const result = evaluateJobEligibility({
        companyName: row.company_name,
        title: row.title,
        description: row.description,
        location: row.location,
        country: row.country,
        workplaceType: row.workplace_type,
        postedAt: row.posted_at ? new Date(row.posted_at) : null
      }, policy);
      if (result.decision === "ELIGIBLE") {
        keep.push(row);
      } else {
        remove.push(row);
        const key = result.reason.split(".")[0] || "RELEVANCE_REJECTED";
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    }

    const backupPath = valueFlag("--backup") ?? path.resolve("artifacts", `job-cleanup-backup-${Date.now()}.json`);
    if (apply) {
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.writeFile(backupPath, JSON.stringify(remove, null, 2), "utf8");
    }

    console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", scanned: rows.rowCount, keep: keep.length, remove: remove.length, reasons, backupPath: apply ? backupPath : null }, null, 2));
    if (!apply) return;

    await database.transaction(async (client) => {
      for (const row of remove) {
        const applications = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM applications WHERE job_opportunity_id = $1`,
          [row.id]
        );
        if (Number(applications.rows[0]?.count ?? 0) > 0) {
          throw new Error(`Refusing to delete ${row.id}: application references this opportunity`);
        }

        await client.query(`DELETE FROM job_opportunities WHERE id = $1`, [row.id]);
      }

      await client.query(
        `DELETE FROM jobs j
         WHERE j.job_opportunity_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)`
      );
    });
  } finally {
    await database.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
