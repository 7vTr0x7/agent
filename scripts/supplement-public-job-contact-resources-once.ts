import { promises as dns } from "node:dns";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { extractEmails, relevance } from "./public-contact-resources-once";
import { fetchPublicEvidenceFallback } from "../src/recruiters/PublicProfileEvidenceFallback";

const HIRING_INTENT = /we['’]?re\s+hiring|we\s+are\s+hiring|hiring\s+(?:for|a|an)|looking\s+for\s+(?:a|an)?\s*(?:frontend|front-end|react|next\.js|javascript|typescript|software|full[ -]?stack)|send\s+(?:your|me\s+your)\s+(?:resume|cv)|share\s+your\s+(?:resume|cv)|apply\s+(?:here|now)|referrals?\s+welcome|talent\s+acquisition|recruit(?:er|ing)|join\s+(?:our|my)\s+team/i;
const ROLE_OR_SKILL = /frontend|front-end|react(?:\.js|js)?|next(?:\.js|js)?|typescript|javascript|software\s+engineer|developer|engineering/i;
const GENERIC = /^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|accommodations?|accessibility|helpdesk)$/i;

async function validateEmail(email: string): Promise<"LIKELY" | "UNVERIFIED" | "INVALID"> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "INVALID";
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "INVALID";
  try {
    return (await dns.resolveMx(domain)).length > 0 ? "LIKELY" : "INVALID";
  } catch {
    return "UNVERIFIED";
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item !== undefined) await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function main(): Promise<void> {
  const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved.");

  const database = new Database(process.env.DATABASE_URL ?? "");
  try {
    const jobs = await database.query<{ canonical_url: string; title: string; company_name: string }>(
      `SELECT canonical_url, title, company_name
         FROM job_opportunities
        WHERE canonical_url IS NOT NULL
          AND (
            LOWER(title) ~ '(react|frontend|front-end|next[.]?js|typescript|javascript|full.?stack|software engineer)'
            OR LOWER(description) ~ '(react|frontend|front-end|next[.]?js|typescript|javascript|full.?stack)'
          )
        ORDER BY created_at DESC NULLS LAST
        LIMIT 80`
    );

    let pagesFetched = 0;
    let emailsExtracted = 0;
    let qualified = 0;
    let persisted = 0;

    await mapLimit(jobs.rows, 4, async (job) => {
      const evidence = await fetchPublicEvidenceFallback(job.canonical_url);
      if (!evidence.text) return;
      pagesFetched += 1;
      const page = evidence.text;
      if (!HIRING_INTENT.test(page) || !ROLE_OR_SKILL.test(page)) return;

      const emails = extractEmails(page).filter((email) => !GENERIC.test(email.split("@")[0] ?? ""));
      emailsExtracted += emails.length;
      if (!emails.length) return;

      const resource = await database.query<{ id: string }>(
        `INSERT INTO public_contact_resources(
           source_url, source_type, title, processed_at, status, records_seen,
           emails_extracted, emails_normalized, invalid_emails, duplicate_emails, qualified_contacts
         ) VALUES($1,'HTML',$2,NOW(),'PROCESSED',$3,$3,$3,0,0,$4)
         ON CONFLICT(source_url) DO UPDATE SET
           processed_at=EXCLUDED.processed_at,
           status='PROCESSED',
           title=EXCLUDED.title,
           records_seen=GREATEST(public_contact_resources.records_seen, EXCLUDED.records_seen),
           emails_extracted=GREATEST(public_contact_resources.emails_extracted, EXCLUDED.emails_extracted),
           emails_normalized=GREATEST(public_contact_resources.emails_normalized, EXCLUDED.emails_normalized),
           qualified_contacts=GREATEST(public_contact_resources.qualified_contacts, EXCLUDED.qualified_contacts)
         RETURNING id`,
        [job.canonical_url, `${job.company_name} — ${job.title}`.slice(0, 300), emails.length, emails.length]
      );
      const resourceId = resource.rows[0]?.id;
      if (!resourceId) return;

      for (const email of emails) {
        const score = relevance(email, page, [...profile.skills], page);
        if (score < 60) continue;
        qualified += 1;
        const validationStatus = await validateEmail(email);
        if (validationStatus === "INVALID") continue;
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain) continue;
        const result = await database.query(
          `INSERT INTO public_contact_resource_contacts(
             resource_id, normalized_email, domain, validation_status, relevance_score,
             evidence_context, observed_at, updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT(resource_id, normalized_email) DO NOTHING
           RETURNING id`,
          [resourceId, email.toLowerCase(), domain, validationStatus, score, page.slice(0, 3500)]
        );
        if (result.rowCount === 1) persisted += 1;
      }
    });

    console.log(JSON.stringify({
      status: "ok",
      feature: "PUBLIC_CONTACT_RESOURCE_SUPPLEMENT",
      independent: true,
      jobsExamined: jobs.rows.length,
      pagesFetched,
      emailsExtracted,
      qualifiedContacts: qualified,
      resourceContactsPersisted: persisted,
      applicationsSent: 0,
      outreachSent: 0
    }, null, 2));
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "FAILED", feature: "PUBLIC_CONTACT_RESOURCE_SUPPLEMENT", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
