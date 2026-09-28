import "dotenv/config";

import { Database } from "../src/database/Database";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const db = new Database(databaseUrl);
  let linked = 0;
  let inserted = 0;
  let unresolved = 0;
  try {
    const opportunities = await db.query<{
      id: string;
      canonical_url: string;
      title: string;
      company_name: string;
      location: string | null;
      country: string | null;
      workplace_type: string | null;
      employment_type: string | null;
      description: string | null;
      posted_at: Date | null;
      last_seen_at: Date | null;
      created_at: Date;
      updated_at: Date | null;
    }>(`
      SELECT jo.id, jo.canonical_url, jo.title, jo.company_name, jo.location,
             jo.country, jo.workplace_type, jo.employment_type, jo.description,
             jo.posted_at, jo.last_seen_at, jo.created_at, jo.updated_at
      FROM job_opportunities jo
      WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.job_opportunity_id = jo.id)
      ORDER BY jo.created_at ASC, jo.id ASC
    `);

    for (const opportunity of opportunities.rows) {
      await db.transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`materialize-job:${opportunity.id}`]);
        const already = await client.query<{ id: string }>(
          `SELECT id FROM jobs WHERE job_opportunity_id = $1::uuid ORDER BY created_at ASC, id ASC LIMIT 1`,
          [opportunity.id]
        );
        if (already.rows[0]) {
          linked += 1;
          return;
        }

        const byUrl = await client.query<{ id: string }>(
          `SELECT id FROM jobs WHERE regexp_replace(trim(url), '[?#].*$', '') = $1 ORDER BY created_at ASC, id ASC LIMIT 1`,
          [opportunity.canonical_url]
        );
        if (byUrl.rows[0]) {
          await client.query(`UPDATE jobs SET job_opportunity_id=$1::uuid, updated_at=NOW() WHERE id=$2`, [opportunity.id, byUrl.rows[0].id]);
          linked += 1;
          return;
        }

        const created = await client.query<{ id: string }>(
          `INSERT INTO jobs (
             source, source_job_id, url, title, company_name, location, country,
             workplace_type, employment_type, description, posted_at, discovered_at,
             content_hash, created_at, updated_at, job_opportunity_id
           ) VALUES (
             'opportunity-materialized', $1::text, $2, $3, $4, $5, $6, $7, $8, $9,
             $10::timestamptz, COALESCE($11::timestamptz, NOW()),
             encode(digest($2 || ':' || $1::text, 'sha256'), 'hex'),
             COALESCE($12::timestamptz, NOW()),
             COALESCE($13::timestamptz, $12::timestamptz, NOW()), $1::uuid
           ) ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
          [
            opportunity.id,
            opportunity.canonical_url,
            opportunity.title,
            opportunity.company_name,
            opportunity.location,
            opportunity.country,
            opportunity.workplace_type,
            opportunity.employment_type,
            opportunity.description,
            opportunity.posted_at,
            opportunity.last_seen_at,
            opportunity.created_at,
            opportunity.updated_at
          ]
        );
        if (created.rows[0]) {
          inserted += 1;
          return;
        }

        const recovered = await client.query<{ id: string }>(
          `SELECT id FROM jobs WHERE job_opportunity_id=$1::uuid OR regexp_replace(trim(url), '[?#].*$', '')=$2 ORDER BY CASE WHEN job_opportunity_id=$1::uuid THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1`,
          [opportunity.id, opportunity.canonical_url]
        );
        if (recovered.rows[0]) {
          await client.query(`UPDATE jobs SET job_opportunity_id=$1::uuid, updated_at=NOW() WHERE id=$2`, [opportunity.id, recovered.rows[0].id]);
          linked += 1;
        } else {
          unresolved += 1;
        }
      });
    }

    const final = await db.query<{ opportunities: string; with_legacy_job: string; missing_legacy_job: string }>(`
      SELECT COUNT(*)::text AS opportunities,
             COUNT(j.id)::text AS with_legacy_job,
             (COUNT(*)-COUNT(j.id))::text AS missing_legacy_job
      FROM job_opportunities jo
      LEFT JOIN jobs j ON j.job_opportunity_id=jo.id
    `);
    console.log(JSON.stringify({ status: unresolved === 0 ? "ok" : "partial", scanned: opportunities.rows.length, linked, inserted, unresolved, final: final.rows[0] }, null, 2));
    if (unresolved > 0) process.exitCode = 1;
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
