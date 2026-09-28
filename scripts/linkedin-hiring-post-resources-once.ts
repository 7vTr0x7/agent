import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { sourceList } from "../src/recruiters/PublicSearchProviderRegistry";

const POST_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"')]+|feed\/update\/urn:li:activity:\d+)/gi;
const HIRING = /we['’]?re hiring|we are hiring|my team is hiring|our team is hiring|hiring:|looking for|send (?:your|me your) (?:resume|cv)|share (?:your|an updated) (?:resume|cv)|dm (?:me|us)|apply (?:here|now)|referrals? welcome/i;
const TECH = /react(?:\.js)?|next(?:\.js)?|typescript|javascript|mern|frontend|front-end|full[ -]?stack|web developer|software engineer|application developer|customer software engineer|product engineer|ui engineer|developer|engineer/i;

function clean(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function canonical(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch { return value.replace(/\/$/, ""); }
}

function extractPosts(text: string): string[] {
  return [...new Set((text.match(POST_URL) ?? []).map(canonical))];
}

function relevant(text: string, skills: string[]): boolean {
  const value = text.toLowerCase();
  if (!HIRING.test(value) || !TECH.test(value)) return false;
  const normalizedSkills = skills.map((skill) => skill.toLowerCase()).filter(Boolean);
  if (!normalizedSkills.length) return true;
  return normalizedSkills.some((skill) => value.includes(skill));
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,text/plain,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; job-agent-linkedin-hiring-resources/1.0)"
      }
    });
    return response.ok ? await response.text() : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function main(): Promise<void> {
  const profiles = ConfiguredCandidateProfileResolver.fromEnvironment();
  const profile = await profiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved.");

  const location = profile.location?.trim() || "India";
  const skills = [...profile.skills];
  const roleTerms = [...profile.targetTitles].slice(0, 8);
  const roleQuery = roleTerms.length ? roleTerms.join(" ") : "Frontend React Developer";
  const queries = [
    `site:linkedin.com/posts "we're hiring" React ${location}`,
    `site:linkedin.com/posts "we are hiring" React ${location}`,
    `site:linkedin.com/posts "MERN" hiring ${location}`,
    `site:linkedin.com/posts "Next.js" hiring ${location}`,
    `site:linkedin.com/posts "Developer – Digital Products" React`,
    `site:linkedin.com/posts "Application Developer" React ${location}`,
    `site:linkedin.com/posts "Customer Software Engineer" React India`,
    `site:linkedin.com/posts "${roleQuery}" hiring ${location}`,
    `site:linkedin.com/posts "send your resume" React India`,
    `site:linkedin.com/posts "share your CV" frontend India`
  ];

  const db = new Database(process.env.DATABASE_URL ?? "");
  let discovered = 0;
  let relevantPosts = 0;
  let persisted = 0;

  try {
    const seen = new Set<string>();
    for (const query of queries) {
      const results = await Promise.all(sourceList(query).map(async (source) => ({ text: await fetchText(source.url) })));
      for (const result of results) {
        if (!result.text) continue;
        for (const postUrl of extractPosts(result.text)) {
          if (seen.has(postUrl)) continue;
          seen.add(postUrl);
          discovered++;
          const start = Math.max(0, result.text.indexOf(postUrl) - 1800);
          const searchContext = result.text.slice(start, Math.min(result.text.length, start + 4200));
          const direct = await fetchText(postUrl);
          const content = clean(`${searchContext} ${direct ?? ""}`);
          if (!relevant(content, skills)) continue;
          relevantPosts++;
          const title = content.match(/(?:hiring|we['’]?re hiring|we are hiring)\s*[:\-–—]?\s*([^.!?]{3,140})/i)?.[1]?.trim()?.slice(0, 300) || "LinkedIn hiring post";
          const emails = [...new Set((content.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? []).map((email) => email.toLowerCase()))];
          await db.query(
            `INSERT INTO public_contact_resources(source_url,source_type,title,discovered_at,status,records_seen,emails_extracted,emails_normalized,invalid_emails,duplicate_emails,qualified_contacts)
             VALUES($1,'LINKEDIN_POST',$2,NOW(),'DISCOVERED',1,$3,$3,0,0,0)
             ON CONFLICT(source_url) DO UPDATE SET title=EXCLUDED.title, records_seen=GREATEST(public_contact_resources.records_seen, EXCLUDED.records_seen), emails_extracted=GREATEST(public_contact_resources.emails_extracted, EXCLUDED.emails_extracted), emails_normalized=GREATEST(public_contact_resources.emails_normalized, EXCLUDED.emails_normalized)`,
            [postUrl, title, emails.length]
          );
          persisted++;
        }
      }
    }
    console.log(JSON.stringify({ queries: queries.length, discovered, relevantPosts, persisted, sourceType: "LINKEDIN_POST" }, null, 2));
  } finally {
    await db.close();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
