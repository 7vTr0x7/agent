import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { sourceList } from "../src/recruiters/PublicSearchProviderRegistry";
import { fetchPublicEvidenceFallback } from "../src/recruiters/PublicProfileEvidenceFallback";
import { extractEmails, relevance, urlsFromSearch } from "./public-contact-resources-once";

const SEARCH_PROVIDER_IDS = new Set([
  "google-direct",
  "bing-direct",
  "brave-direct",
  "mojeek-direct",
  "qwant-direct",
  "yahoo-direct"
]);

const QUERIES = [
  '"frontend developer" Bengaluru hiring email',
  '"React developer" Bangalore hiring email',
  '"frontend engineer" India "send your resume"',
  '"React" Bengaluru "talent acquisition" email',
  '"technical recruiter" React Bengaluru email',
  '"talent acquisition" frontend India email',
  '"hiring" "Next.js" Bengaluru email',
  '"we are hiring" frontend India email'
];

const GENERIC = /^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|helpdesk)$/i;

export function searchSources(query: string) {
  return sourceList(query).filter((source) => SEARCH_PROVIDER_IDS.has(source.id));
}

function contextAround(text: string, email: string): string {
  const index = text.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) return text.slice(0, 3500);
  return text.slice(Math.max(0, index - 1200), Math.min(text.length, index + email.length + 1200));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function main(): Promise<void> {
  const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved.");

  const db = new Database(process.env.DATABASE_URL ?? "");
  try {
    const searchRequests = QUERIES.flatMap((query) => searchSources(query).map((source) => ({ query, source })));
    const searchPages = (await mapLimit(searchRequests, 4, async ({ source }) => {
      const evidence = await fetchPublicEvidenceFallback(source.url);
      return evidence.text ? { source: source.url, text: evidence.text } : null;
    })).filter((value): value is { source: string; text: string } => Boolean(value));

    const candidateUrls = new Set<string>();
    for (const page of searchPages) {
      for (const url of urlsFromSearch(page.text)) candidateUrls.add(url);
    }

    const targetUrls = [...candidateUrls].slice(0, Number(process.env.PUBLIC_CONTACT_SEARCH_MAX_TARGETS ?? 80));
    let pagesFetched = 0;
    let emailsExtracted = 0;
    let qualified = 0;
    let persisted = 0;
    let duplicates = 0;

    await mapLimit(targetUrls, 4, async (url) => {
      const evidence = await fetchPublicEvidenceFallback(url);
      if (!evidence.text) return;
      pagesFetched += 1;
      const page = evidence.text;
      const emails = extractEmails(page).filter((email) => !GENERIC.test(email.split("@")[0] ?? ""));
      emailsExtracted += emails.length;
      if (!emails.length) return;

      const pageLooksHiring = /we['’]?re\s+hiring|we\s+are\s+hiring|hiring|looking\s+for|send\s+(?:your|me\s+your)\s+(?:resume|cv)|talent\s+acquisition|recruit(?:er|ing)/i.test(page)
        && /frontend|front-end|react(?:\.js|js)?|next(?:\.js|js)?|typescript|javascript|software\s+engineer|developer|engineering/i.test(page);
      if (!pageLooksHiring) return;

      const resource = await db.query<{ id: string }>(
        `INSERT INTO public_contact_resources(
           source_url, source_type, title, processed_at, status, records_seen,
           emails_extracted, emails_normalized, invalid_emails, duplicate_emails, qualified_contacts
         ) VALUES($1,'HTML',$2,NOW(),'PROCESSED',$3,$3,$3,0,$4)
         ON CONFLICT(source_url) DO UPDATE SET
           processed_at=EXCLUDED.processed_at,
           status='PROCESSED',
           records_seen=GREATEST(public_contact_resources.records_seen, EXCLUDED.records_seen),
           emails_extracted=GREATEST(public_contact_resources.emails_extracted, EXCLUDED.emails_extracted),
           emails_normalized=GREATEST(public_contact_resources.emails_normalized, EXCLUDED.emails_normalized),
           qualified_contacts=GREATEST(public_contact_resources.qualified_contacts, EXCLUDED.qualified_contacts)
         RETURNING id`,
        [url, `${new URL(url).hostname} public hiring/contact evidence`.slice(0, 300), emails.length, emails.length]
      );
      const resourceId = resource.rows[0]?.id;
      if (!resourceId) return;

      for (const email of emails) {
        const context = contextAround(page, email);
        const score = relevance(email, context, [...profile.skills], page);
        if (score < 60) continue;
        qualified += 1;
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain) continue;
        const validationStatus = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "UNVERIFIED" : "INVALID";
        if (validationStatus === "INVALID") continue;
        const result = await db.query(
          `INSERT INTO public_contact_resource_contacts(
             resource_id, normalized_email, domain, validation_status, relevance_score,
             evidence_context, observed_at, updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT(resource_id, normalized_email) DO NOTHING
           RETURNING id`,
          [resourceId, email.toLowerCase(), domain, validationStatus, score, context.slice(0, 3500)]
        );
        if (result.rowCount === 1) persisted += 1;
        else duplicates += 1;
      }
    });

    console.log(JSON.stringify({
      status: "ok",
      feature: "PUBLIC_CONTACT_SEARCH_EVIDENCE",
      independent: true,
      searchPages: searchPages.length,
      targetUrls: targetUrls.length,
      pagesFetched,
      emailsExtracted,
      qualifiedContacts: qualified,
      resourceContactsPersisted: persisted,
      duplicates,
      applicationsSent: 0,
      outreachSent: 0
    }, null, 2));
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "FAILED", feature: "PUBLIC_CONTACT_SEARCH_EVIDENCE", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
