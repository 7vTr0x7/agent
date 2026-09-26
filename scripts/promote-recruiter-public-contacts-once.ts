import { Database } from "../src/database/Database";

function publicSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) return false;
    if (/^(?:127|10|192\.168)\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const database = new Database(process.env.DATABASE_URL ?? "");
  try {
    const candidates = await database.query<{
      email: string;
      company_name: string;
      source_url: string;
      relevance_score: number | null;
      confidence: number | null;
      email_status: string;
      domain_status: string;
      relevance_status: string | null;
    }>(
      `SELECT DISTINCT ON (LOWER(c.email))
          c.email,
          c.company_name,
          s.source_url,
          c.relevance_score,
          c.confidence,
          c.email_status,
          c.domain_status,
          c.relevance_status
       FROM recruiter_contacts c
       JOIN recruiter_contact_sources s ON s.recruiter_contact_id = c.id
       WHERE c.email IS NOT NULL
         AND c.email_status IN ('LIKELY','VERIFIED')
         AND c.domain_status = 'VALID'
         AND COALESCE(c.suppressed,FALSE) = FALSE
         AND COALESCE(c.confidence,0) >= 80
         AND COALESCE(c.relevance_score,0) >= 60
         AND COALESCE(c.relevance_status,'UNKNOWN') IN ('CURRENT','RECENT')
         AND NULLIF(TRIM(s.source_url),'') IS NOT NULL
       ORDER BY LOWER(c.email), c.relevance_score DESC NULLS LAST, c.confidence DESC NULLS LAST, s.observed_at DESC`
    );

    let promoted = 0;
    let existing = 0;
    let rejected = 0;
    for (const row of candidates.rows) {
      if (!publicSource(row.source_url)) {
        rejected += 1;
        continue;
      }
      const result = await database.query<{ inserted: boolean }>(
        `INSERT INTO contacts (company_name, email, source, created_at, updated_at)
         VALUES ($1,$2,$3,NOW(),NOW())
         ON CONFLICT (email) DO UPDATE SET
           company_name = CASE WHEN NULLIF(TRIM(contacts.company_name),'') IS NULL THEN EXCLUDED.company_name ELSE contacts.company_name END,
           source = EXCLUDED.source,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [row.company_name.slice(0,500), row.email.trim().toLowerCase(), row.source_url]
      );
      if (result.rows[0]?.inserted) promoted += 1;
      else existing += 1;
    }

    const count = await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM contacts");
    console.log(JSON.stringify({
      status: "ok",
      feature: "PUBLIC_RECRUITER_CONTACT_PROMOTION",
      candidates: candidates.rows.length,
      contactsPromoted: promoted,
      existingContacts: existing,
      rejectedUnsafeSources: rejected,
      contactsPersisted: Number(count.rows[0]?.count ?? 0),
      applicationsSent: 0,
      outreachSent: 0
    }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", feature: "PUBLIC_RECRUITER_CONTACT_PROMOTION", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
