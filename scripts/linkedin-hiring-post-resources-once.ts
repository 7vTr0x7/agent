import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { sourceList } from "../src/recruiters/PublicSearchProviderRegistry";
import { extractLinkedInPostPublishedAt, isWithinLinkedInRecentWindow, linkedinRecentPostCutoff } from "../src/recruiters/LinkedInPostDate";

const POST_URL = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:posts\/[^\s<>"')&]+|feed\/update\/urn:li:activity:\d+)/gi;
const LINKEDIN_HOST = /^(?:www\.)?linkedin\.com$/i;
const LINKEDIN_PATH = /^\/(?:posts\/[^\s<>"')&]+|feed\/update\/urn:li:activity:\d+)$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const STRONG_HIRING = /we['’]?\s+hiring|we\s+are\s+hiring|my\s+team\s+is\s+hiring|our\s+team\s+is\s+hiring|i['’]?\s+hiring|i\s+am\s+hiring|hiring\s+(?:for|:)|opening\s+(?:for|:)|job\s+opening|vacancy|urgent\s+opening|actively\s+hiring|position\s+available|join\s+(?:our|my)\s+team|send\s+(?:your|me\s+your)\s+(?:resume|cv)\s+to|share\s+(?:your|an\s+updated)\s+(?:resume|cv)\s+to|dm\s+(?:me|us)\s+(?:for|about|your)|referrals?\s+welcome/i;
const TECH_ROLE = /(?:frontend|front-end|front\s+end|react(?:\.js)?|next(?:\.js)?|typescript|javascript|mern|full[ -]?stack|node(?:\.js)?|express(?:\.js)?|web\s+developer|software\s+(?:developer|engineer)|(?:software|frontend|full[ -]?stack|web)\s+engineer)/i;
const TECH = /react(?:\.js)?|next(?:\.js)?|typescript|javascript|mern|frontend|front-end|full[ -]?stack|node(?:\.js)?|express(?:\.js)?|developer|engineer/i;
const BLOCKED_LOCAL = /^(?:support|info|admin|press|media|legal|privacy|marketing|sales|hello|contact|help|feedback|abuse|postmaster|webmaster|noreply|no-reply|donotreply|automation|automated|bot|machine|system)$/i;
const GENERIC_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);
const NON_RECRUITING = /customer support|technical support|sales|billing|privacy|legal|security|press|media|partnerships?|helpdesk|procurement|accounting|finance|customer success|marketing/i;

function clean(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#64;|&#x40;/gi, "@").replace(/&#46;|&#x2e;/gi, ".").replace(/\s+/g, " ").trim();
}

function decodeRepeated(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function canonical(value: string): string | null {
  try {
    let raw = decodeRepeated((value.trim().split("](")[0] ?? "").split(")(")[0] ?? "")
      .replace(/&amp;/gi, "&")
      .replace(/[\\\]},.;)]+$/g, "");

    // Search providers sometimes expose the same LinkedIn host twice
    // (for example https://www.linkedin.com/www.linkedin.com/posts/...).
    raw = raw.replace(
      /^https?:\/\/(?:www\.)?linkedin\.com\/(?:www\.)?linkedin\.com\//i,
      "https://www.linkedin.com/"
    );

    // Never persist a search-provider wrapper as though it were a LinkedIn post.
    if (/^https?:\/\/(?:www\.)?(?:duckduckgo|bing|google|yahoo|qwant)\./i.test(raw)) {
      return null;
    }

    const candidate = /^https?:\/\//i.test(raw) ? raw : "https://www.linkedin.com/" + raw.replace(/^\/+/, "");
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol) || !LINKEDIN_HOST.test(url.hostname) || !LINKEDIN_PATH.test(url.pathname)) return null;
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId", "lipi", "rut"].forEach((key) => url.searchParams.delete(key));
    url.hostname = "www.linkedin.com";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

function extractPosts(text: string): string[] {
  const decoded = decodeRepeated(
    text
      .replace(/&amp;/gi, "&")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
  );

  // Extract redirect targets such as DuckDuckGo's ?uddg=<encoded LinkedIn URL>
  // before scanning the surrounding search-result HTML.
  const redirectTargets = [...decoded.matchAll(/[?&](?:uddg|url|u)=([^&\s"<>]+)/gi)]
    .map((match) => decodeRepeated(match[1] ?? ""))
    .join("\n");

  const normalized = [decoded, redirectTargets]
    .join("\n")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/");

  return [...new Set((normalized.match(POST_URL) ?? [])
    .map((value) => canonical(value))
    .filter((value): value is string => Boolean(value)))];
}

function relevant(text: string, skills: string[]): boolean {
  const value = clean(text).toLowerCase();
  if (!STRONG_HIRING.test(value) || !TECH_ROLE.test(value) || !TECH.test(value)) return false;
  const normalizedSkills = skills.map((skill) => skill.toLowerCase()).filter(Boolean);
  return !normalizedSkills.length || normalizedSkills.some((skill) => value.includes(skill));
}

function validPostTitle(text: string): string {
  const value = clean(text)
    .replace(/(?:\[[^\]]*\]\()?https?:\/\/[^\s)]+\)?/gi, " ")
    .replace(/\b(?:duckduckgo|bing|google|yahoo|startpage|ecosia)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = value.match(/(?:we['’]?re hiring|we are hiring|my team is hiring|our team is hiring|hiring|opening|vacancy|position available)\s*[:\-–—]?\s*([^.!?]{3,180})/i);
  const candidate = match?.[1]?.trim() || value.slice(0, 180);
  return candidate.replace(/^[\s"'“”‘’:#-]+|[\s"'“”‘’]+$/g, "").slice(0, 300) || "LinkedIn technical hiring post";
}

function recruitingEmails(text: string): string[] {
  const normalized = clean(text);
  return [...new Set((normalized.match(EMAIL) ?? []).map((email) => email.toLowerCase()))].filter((email) => {
    const parts = email.split("@"); const local = parts[0]; const domain = parts[1];
    if (!local || !domain || GENERIC_DOMAINS.has(domain) || BLOCKED_LOCAL.test(local)) return false;
    const index = normalized.toLowerCase().indexOf(email);
    const context = normalized.slice(Math.max(0, index - 500), Math.min(normalized.length, index + 500));
    if (NON_RECRUITING.test(context) && !/recruiter|recruiting|talent|hiring|hr/i.test(context)) return false;
    return /send|email|contact|reach out|resume|cv|apply|hiring|recruiting|recruiter|talent|job|dm/i.test(context);
  });
}

function evidenceFor(text: string, postUrl: string): string {
  const index = text.toLowerCase().indexOf(postUrl.toLowerCase());
  return clean(index >= 0 ? text.slice(Math.max(0, index - 1800), Math.min(text.length, index + 4200)) : text).slice(0, 6500);
}

async function fetchSearch(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<string | null> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000); const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "text/plain,text/html,application/json,*/*;q=0.8", "user-agent": "job-agent-linkedin-public-hiring-resources/1.0", ...(headers ?? {}) } });
    const body = await response.text();
    if (response.ok) return body;
    return /linkedin\.com\/(?:posts\/|feed\/update\/)/i.test(body) ? body : null;
  } catch { return null; }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

async function search(query: string, signal: AbortSignal): Promise<string[]> {
  const sources = sourceList(query); const texts: string[] = [];
  for (let offset = 0; offset < sources.length; offset += 4) {
    if (signal.aborted) break;
    const pages = await Promise.all(sources.slice(offset, offset + 4).map((source) => fetchSearch(source.url, signal, source.headers)));
    for (const page of pages) if (page) texts.push(page);
  }
  return texts;
}

async function fetchLinkedInPost(url: string, signal: AbortSignal): Promise<{ text: string | null; direct: boolean }> {
  const direct = await fetchSearch(url, signal, {
    accept: "text/html,text/plain,*/*;q=0.8",
    "user-agent": "Mozilla/5.0 (compatible; job-agent-linkedin-public-hiring-resources/1.0)"
  });
  if (direct && !/(?:authwall|join linkedin|sign in|sign up|page not found|agree & join)/i.test(direct.slice(0, 12000))) {
    return { text: direct, direct: true };
  }
  const reader = await fetchSearch(`https://r.jina.ai/${url}`, signal, {
    accept: "text/plain,*/*;q=0.8"
  });
  return { text: reader ?? direct, direct: Boolean(direct) };
}

async function main(): Promise<void> {
  const resolver = ConfiguredCandidateProfileResolver.fromEnvironment();
  const profile = await resolver.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved.");
  const location = profile.location?.trim() || "India";
  const roleQuery = [...profile.targetTitles].slice(0, 8).join(" ") || "Frontend React Developer";
  const queries = [...new Set([
    `site:linkedin.com/posts "we're hiring" React ${location}`,
    `site:linkedin.com/posts "we are hiring" React ${location}`,
    `site:linkedin.com/posts "my team is hiring" ${roleQuery} ${location}`,
    `site:linkedin.com/posts "send your resume" React ${location}`,
    `site:linkedin.com/posts "share your CV" frontend ${location}`,
    `site:linkedin.com/posts "DM me" React recruiter ${location}`,
    `site:linkedin.com/posts "hiring" "Next.js" ${location}`,
    `site:linkedin.com/posts "hiring" "TypeScript" ${location}`,
    `site:linkedin.com/posts "${roleQuery}" hiring ${location}`,
    `site:linkedin.com/posts "Frontend Developer" Bengaluru React`,
    `site:linkedin.com/posts "React Developer" Bengaluru TypeScript`,
    `site:linkedin.com/posts "Frontend Engineer" Pune React`,
    `site:linkedin.com/posts "send your resume" React India`,
    `site:linkedin.com/posts "share your CV" React India`,
    `site:linkedin.com/posts "hiring" "React" India`,
    `site:linkedin.com/posts "hiring" "Next.js" India`,
    `site:linkedin.com/posts "hiring" "Node.js" India`,
    `site:linkedin.com/posts "hiring" "JavaScript" India`,
    `site:linkedin.com/posts "hiring" "TypeScript" India`,
    `site:linkedin.com/posts "hiring" "MERN" India`,
    `site:linkedin.com/posts "opening" "React Developer" India`,
    `site:linkedin.com/posts "opening" "Frontend Engineer" India`,
    `site:linkedin.com/posts "urgent opening" React India`,
    `site:linkedin.com/posts "actively hiring" React India`,
    `site:linkedin.com/posts "join our team" React India`,
    `site:linkedin.com/posts "send your resume to" React India`,
    `site:linkedin.com/posts "DM me" "Frontend Developer" India`,
    `site:linkedin.com/posts "we're hiring" "Frontend Engineer" India`,
    `site:linkedin.com/posts "we are hiring" "React Developer" India`,
    `site:linkedin.com/posts "my team is hiring" "Frontend" India`,
    `site:linkedin.com/posts "full stack developer" hiring Bengaluru`,
    `site:linkedin.com/posts "full stack developer" hiring Bangalore`,
    `site:linkedin.com/posts "frontend developer" hiring Bengaluru`,
    `site:linkedin.com/posts "frontend developer" hiring Bangalore`,
    `site:linkedin.com/posts "React developer" hiring Pune`,
    `site:linkedin.com/posts "Next.js developer" hiring Pune`,
    `site:linkedin.com/posts "software engineer" hiring India React`,
    `site:linkedin.com/posts "software developer" hiring India JavaScript`,
    `site:linkedin.com/posts "Node.js developer" hiring India`,
    `site:linkedin.com/posts "TypeScript developer" hiring India`,
    `site:linkedin.com/posts "React engineer" hiring India`,
    `site:linkedin.com/posts "frontend engineer" hiring India`,
    `site:linkedin.com/posts "MERN developer" hiring India`,
    `site:linkedin.com/posts "web developer" hiring India React`,
  ])].slice(0, Math.max(1, Math.min(Number(process.env.LINKEDIN_HIRING_POST_RESOURCE_MAX_QUERIES ?? 48), 64)));
  const skills = [...profile.skills];
  const cutoff = linkedinRecentPostCutoff(new Date());
  const queriesWithRecency = queries.map((query) => `${query} after:${cutoff.toISOString().slice(0, 10)}`);
  const signal = AbortSignal.timeout(Number(process.env.LINKEDIN_HIRING_POST_RESOURCE_TIMEOUT_MS ?? 300000));
  const db = new Database(process.env.DATABASE_URL ?? "");
  const seen = new Set<string>();
  let discovered = 0; let relevantPosts = 0; let persisted = 0; let emailsExtracted = 0; let contactRowsPersisted = 0; let directLinkedInFetches = 0; let postFetchFailures = 0;
  try {
    for (const query of queriesWithRecency) {
      if (signal.aborted) break;
      for (const page of await search(query, signal)) {
        const candidates = extractPosts(page)
          .map((postUrl) => {
            const searchEvidence = evidenceFor(page, postUrl);
            return { postUrl, searchEvidence, postedAt: extractLinkedInPostPublishedAt(searchEvidence) };
          })
          .filter((candidate) => isWithinLinkedInRecentWindow(candidate.postedAt))
          .sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0));
        for (const candidate of candidates) {
          const { postUrl, searchEvidence } = candidate;
          if (seen.has(postUrl)) continue;
          seen.add(postUrl); discovered++;
          const fetched = await fetchLinkedInPost(postUrl, signal);
          if (fetched.direct) directLinkedInFetches++;
          if (!fetched.text) postFetchFailures++;
          const fetchedContent = clean(fetched.text ?? "");
          const content = clean(fetchedContent + " " + searchEvidence);
          const postedAt = extractLinkedInPostPublishedAt(postUrl) ?? extractLinkedInPostPublishedAt(fetched.text ?? "") ?? candidate.postedAt;
          if (!isWithinLinkedInRecentWindow(postedAt)) continue;
          if (!relevant(content, skills)) continue;
          relevantPosts++;
          const emails = recruitingEmails(content); emailsExtracted += emails.length;
          const title = validPostTitle(fetchedContent || searchEvidence);
          const resource = await db.query<{ id: string }>(
            `INSERT INTO public_contact_resources(source_url,source_type,title,discovered_at,posted_at,status,records_seen,emails_extracted,emails_normalized,invalid_emails,duplicate_emails,qualified_contacts)
             VALUES($1,'LINKEDIN_POST',$2,NOW(),$3,'DISCOVERED',1,$4,$4,0,0,$5)
             ON CONFLICT(source_url) DO UPDATE SET title=EXCLUDED.title, posted_at=COALESCE(EXCLUDED.posted_at, public_contact_resources.posted_at), records_seen=GREATEST(public_contact_resources.records_seen, EXCLUDED.records_seen), emails_extracted=GREATEST(public_contact_resources.emails_extracted, EXCLUDED.emails_extracted), emails_normalized=GREATEST(public_contact_resources.emails_normalized, EXCLUDED.emails_normalized), qualified_contacts=GREATEST(public_contact_resources.qualified_contacts, EXCLUDED.qualified_contacts)
             RETURNING id`,
            [postUrl, title, postedAt?.toISOString() ?? null, emails.length, emails.length]
          );
          const resourceId = resource.rows[0]?.id;
          if (resourceId) {
            for (const email of emails) {
              const index = clean(content).toLowerCase().indexOf(email.toLowerCase());
              const context = clean(content).slice(Math.max(0, index - 700), Math.min(clean(content).length, index + 1400)).slice(0, 3500);
              const inserted = await db.query(
                `INSERT INTO public_contact_resource_contacts(resource_id,normalized_email,domain,validation_status,relevance_score,evidence_context,observed_at,updated_at)
                 VALUES($1,$2,$3,'LIKELY',80,$4,NOW(),NOW())
                 ON CONFLICT(resource_id,normalized_email) DO UPDATE SET validation_status='LIKELY',relevance_score=GREATEST(public_contact_resource_contacts.relevance_score,80),evidence_context=EXCLUDED.evidence_context,updated_at=NOW()
                 RETURNING id`,
                [resourceId, email, email.split("@")[1] ?? "", context]
              );
              if (inserted.rowCount === 1) contactRowsPersisted += 1;
            }
          }
          persisted++;
        }
      }
    }
    console.log(JSON.stringify({ queries: queriesWithRecency.length, cutoff: cutoff.toISOString(), discovered, relevantPosts, persisted, emailsExtracted, contactRowsPersisted, sourceType: "LINKEDIN_POST", directLinkedInFetches, postFetchFailures }, null, 2));
  } finally { await db.close(); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
