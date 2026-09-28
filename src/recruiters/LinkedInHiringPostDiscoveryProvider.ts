import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";

type SearchSource = { id: string; url: string };

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LINKEDIN_POST = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"')]+|feed\/update\/urn:li:activity:\d+)/gi;
const LINKEDIN_PROFILE = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const HIRING = /(?:we['’]?re hiring|we are hiring|i['’]?m hiring|i am hiring|my team is hiring|our team is hiring|we['’]?re looking for|we are looking for|hiring:|we'?re hiring|open position|open positions|send (?:your|me your) (?:resume|cv)|share (?:your|an updated) (?:resume|cv)|dm (?:me|us)|reach out|apply now|referrals? welcome)/i;
const RECRUITER_ROLE = /recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|hr professional|human resources|staffing|people operations|founder|co-founder|cofounder|talent advisor/i;
const NON_RECRUITER = /customer support|technical support|sales executive|accounting|finance|marketing|press|media|legal|privacy/i;
const GENERIC_EMAIL = /^(?:gmail|outlook|hotmail|yahoo|icloud|proton(?:mail)?)[.]com$/i;
const ROLE_TERMS = /(?:frontend|front-end|react(?:\.js)?|next\.js|javascript|typescript|full[ -]?stack|mern|web developer|software engineer|application developer|ui engineer|product engineer|developer|engineer)/i;
const SKILLS = [
  "React", "React.js", "Next.js", "TypeScript", "JavaScript", "Node.js", "Express.js", "MongoDB", "REST APIs", "GraphQL", "Redux", "Redux Toolkit", "Tailwind CSS", "HTML", "CSS", "Jest", "Playwright", "Docker", "Git/GitHub"
];
const SEARCH_HOSTS = new Set(["google.com", "www.google.com", "bing.com", "www.bing.com", "duckduckgo.com", "html.duckduckgo.com", "startpage.com", "www.startpage.com", "ecosia.org", "www.ecosia.org", "qwant.com", "www.qwant.com", "search.yahoo.com", "www.yahoo.com", "search.brave.com", "www.mojeek.com"]);

function clean(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(email: string): string | undefined {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain && !GENERIC_EMAIL.test(domain) ? domain : undefined;
}

function canonical(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function plausibleName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 5 || name.length > 80) return false;
  const parts = name.split(" ");
  return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[A-Z][A-Za-z.'-]+$/.test(part));
}

function extractName(text: string): string | undefined {
  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})['’]s\s+Post\b/,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo|5mo|6mo)\b/i,
    /\b(?:DM|contact|reach out to)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\b/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]?.trim();
    if (match && plausibleName(match)) return match;
  }
  return undefined;
}

function extractRole(text: string, input: RecruiterDiscoveryInput): string {
  const explicit = text.match(/(?:hiring|looking for|open position|open role|role)\s*[:\-–—]?\s*(?:a|an)?\s*([A-Za-z][A-Za-z0-9+.#/()& -]{2,90})(?=\s*(?:\||\.|,|\n|📍|💼|experience|location|skills|required|$))/i)?.[1]?.trim();
  if (explicit && ROLE_TERMS.test(explicit)) return explicit;
  if (ROLE_TERMS.test(input.jobTitle)) return input.jobTitle;
  const titleLine = text.match(/(?:^|\s)([A-Z][A-Za-z0-9+.#/()& -]{2,70}(?:Developer|Engineer|Developer – Frontend|Developer - Frontend))(?:\s|$)/)?.[1]?.trim();
  return titleLine || input.jobTitle;
}

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  return [...new Set(SKILLS.filter((skill) => lower.includes(skill.toLowerCase())))].slice(0, 12);
}

function extractLocation(text: string): string | undefined {
  const match = text.match(/(?:📍|location|based in|work location)\s*[:\-]?\s*([^|\n]{2,70})/i)?.[1]?.trim();
  return match?.replace(/(?:💼|experience|work mode|employment type).*$/i, "").trim() || undefined;
}

function extractExperience(text: string): string | undefined {
  return text.match(/(?:experience|exp)\s*[:\-]?\s*(\d+\s*(?:-|to|–|—)\s*\d+\s*years?|\d+\+?\s*years?)/i)?.[1]?.trim();
}

function experienceCompatible(text: string, years: number): boolean {
  const ranges = [...text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)];
  if (!ranges.length) return true;
  return ranges.some((match) => years >= Number(match[1]) && years <= Number(match[2])) || /\b(?:0|1|2|3)\s*[-+]?\s*years?/i.test(text);
}

function sourceList(query: string): SearchSource[] {
  const q = encodeURIComponent(query);
  return [
    { id: "google", url: `https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1` },
    { id: "bing", url: `https://r.jina.ai/https://www.bing.com/search?q=${q}` },
    { id: "duckduckgo", url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}` },
    { id: "startpage", url: `https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}` }
  ];
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/plain,text/html,application/xhtml+xml,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; job-agent-linkedin-hiring-posts/1.0)"
      }
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function extractUrls(text: string): string[] {
  return [...new Set((text.match(LINKEDIN_POST) ?? []).map(canonical))];
}

function candidateFromText(text: string, postUrl: string, input: RecruiterDiscoveryInput): RecruiterContactCandidate | null {
  const normalized = clean(text);
  if (!HIRING.test(normalized) || !ROLE_TERMS.test(normalized)) return null;
  if (!experienceCompatible(normalized, 3)) return null;

  const emails = [...new Set((normalized.match(EMAIL) ?? []).map((email) => email.toLowerCase()))];
  const email = emails.find((value) => domainOf(value) && !NON_RECRUITER.test(normalized.slice(Math.max(0, normalized.indexOf(value) - 180), normalized.indexOf(value) + 180))) ?? emails.find((value) => domainOf(value));
  const employerDomain = email ? domainOf(email) : undefined;
  const name = extractName(normalized);
  const profileUrl = normalized.match(LINKEDIN_PROFILE)?.[0];
  const recruiterLike = RECRUITER_ROLE.test(normalized);
  if (!name && !email) return null;
  if (!recruiterLike && !email) return null;
  if (NON_RECRUITER.test(normalized) && !recruiterLike) return null;

  const skills = extractSkills(normalized);
  const role = extractRole(normalized, input);
  const location = extractLocation(normalized);
  const experience = extractExperience(normalized);
  const score = Math.min(100, 45 + skills.length * 4 + (email ? 15 : 0) + (name ? 15 : 0) + (profileUrl ? 10 : 0));
  const evidence = [
    `LinkedIn hiring post: ${postUrl}`,
    `Hiring evidence: ${normalized.slice(0, 900)}`,
    `Role: ${role}`,
    skills.length ? `Skills: ${skills.join(", ")}` : "",
    location ? `Location: ${location}` : "",
    experience ? `Experience: ${experience}` : "",
    email ? `Public contact: ${email}` : ""
  ].filter(Boolean);

  return {
    email: email ?? "",
    fullName: name ?? (email ? "Employer recruiting contact" : undefined),
    title: recruiterLike ? "Recruiter / Hiring Contact" : "Hiring Contact",
    department: "Recruiting",
    confidence: score / 100,
    verified: false,
    verificationStatus: email ? "public_hiring_post_unverified" : "public_hiring_post_identity",
    provider: "linkedin-hiring-post",
    linkedinProfileUrl: profileUrl,
    companyDomain: employerDomain,
    location,
    recruitingContext: normalized.slice(0, 1000),
    discoveryEvidence: evidence,
    discoveredAt: new Date(),
    sources: [{ url: postUrl, type: "linkedin_hiring_post", confidence: score / 100 }]
  };
}

export class LinkedInHiringPostDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "linkedin-hiring-posts";
  private readonly verifier = new PublicRecruiterSearchProvider();

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const title = input.jobTitle.trim();
    const company = input.companyName.trim();
    const location = input.location?.trim() || "India";
    const tech = extractSkills(input.jobDescription).slice(0, 4).join(" ") || "React Next.js TypeScript JavaScript";
    const queries = [
      `site:linkedin.com/posts "we're hiring" "${tech}" "${location}"`,
      `site:linkedin.com/posts "we are hiring" "${title}" "${location}"`,
      `site:linkedin.com/posts "hiring" "${tech}" "${location}" recruiter`,
      `site:linkedin.com/posts "${company}" hiring ${tech}`,
      `site:linkedin.com/posts "send your resume" ${tech} ${location}`,
      `site:linkedin.com/posts "share your CV" ${tech} ${location}`
    ];

    const contacts = new Map<string, RecruiterContactCandidate>();
    let queriesExecuted = 0;
    let rawPages = 0;
    let uniqueUrls = 0;

    for (const query of queries) {
      if (input.candidateProfileId && contacts.size >= 12) break;
      queriesExecuted++;
      const sources = sourceList(query);
      for (const source of sources) {
        const page = await fetchText(source.url);
        if (!page) continue;
        rawPages++;
        const urls = extractUrls(page);
        uniqueUrls += urls.length;
        for (const postUrl of urls.slice(0, 8)) {
          const contextStart = Math.max(0, page.indexOf(postUrl) - 1400);
          const context = page.slice(contextStart, Math.min(page.length, contextStart + 3600));
          const direct = await fetchText(postUrl);
          const candidate = candidateFromText(`${context}\n${direct ?? ""}`, postUrl, input);
          if (!candidate) continue;
          const key = candidate.linkedinProfileUrl?.toLowerCase() || candidate.email.toLowerCase() || postUrl;
          const existing = contacts.get(key);
          if (!existing || (candidate.confidence ?? 0) > (existing.confidence ?? 0)) contacts.set(key, candidate);
        }
      }
    }

    return {
      provider: this.name,
      contacts: [...contacts.values()].slice(0, 12),
      discoveredAt: new Date(),
      metrics: {
        queriesGenerated: queries.length,
        queriesExecuted,
        rawPages,
        uniqueUrls,
        linkedinUrls: uniqueUrls,
        recruiterCandidates: contacts.size,
        duplicateCandidates: Math.max(0, uniqueUrls - contacts.size),
        rejectedCandidates: 0,
        sourceStats: {}
      }
    };
  }

  async discoverEmails(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const result = await this.discover(input);
    return { ...result, contacts: result.contacts.filter((contact) => Boolean(contact.email)) };
  }

  verify(email: string): Promise<RecruiterVerificationResult> {
    return this.verifier.verify(email);
  }
}
