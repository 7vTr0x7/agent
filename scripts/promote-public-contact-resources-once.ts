import { spawnSync } from "node:child_process";
import { Database } from "../src/database/Database";

function runDiscovery(): void {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/public-contact-resources-once.ts"], {
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`Public contact resource discovery failed with exit code ${result.status ?? "unknown"}.`);
  }
}

async function main(): Promise<void> {
  runDiscovery();

  const database = new Database(process.env.DATABASE_URL ?? "");
  try {
    const result = await database.query<{
      id: string;
      email: string;
      title: string;
      source_url: string;
      validation_status: string;
      relevance_score: number;
    }>(
      `SELECT DISTINCT ON (c.normalized_email)
          c.id,
          c.normalized_email AS email,
          r.title,
          r.source_url,
          c.validation_status,
          c.relevance_score
       FROM public_contact_resource_contacts c
       JOIN public_contact_resources r ON r.id = c.resource_id
       WHERE c.relevance_score >= 60
         AND c.validation_status <> 'INVALID'
         AND NULLIF(TRIM(c.normalized_email), '') IS NOT NULL
       ORDER BY c.normalized_email, c.relevance_score DESC, c.observed_at DESC`
    );

    let inserted = 0;
    let existing = 0;
    for (const row of result.rows) {
      const companyName = row.title.trim() || new URL(row.source_url).hostname;
      const upsert = await database.query<{ inserted: boolean }>(
        `INSERT INTO contacts (company_name, email, source, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET
           company_name = CASE
             WHEN contacts.company_name IS NULL OR contacts.company_name = '' THEN EXCLUDED.company_name
             ELSE contacts.company_name
           END,
           source = EXCLUDED.source,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [companyName.slice(0, 500), row.email.toLowerCase(), row.source_url]
      );
      if (upsert.rows[0]?.inserted) inserted += 1;
      else existing += 1;
    }

    const contactCount = await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM contacts");
    console.log(JSON.stringify({
      status: "ok",
      feature: "PUBLIC_CONTACT_RESOURCE",
      independent: true,
      contactsPromoted: inserted,
      existingContacts: existing,
      contactsPersisted: Number(contactCount.rows[0]?.count ?? 0),
      applicationsSent: 0,
      outreachSent: 0,
      source: "public_contact_resource_contacts"
    }, null, 2));
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "FAILED",
      feature: "PUBLIC_CONTACT_RESOURCE",
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  });
}
