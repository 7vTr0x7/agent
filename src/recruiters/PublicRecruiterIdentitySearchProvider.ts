import { RecruiterDiscoveryInput, RecruiterIdentityCandidate } from "./RecruiterDiscovery";
import { sourceList } from "./PublicSearchProviderRegistry";

const RECRUITING_CONTEXT = /(recruiter|recruiting|talent acquisition|talent partner|talent acquisition partner|technical recruiter|engineering recruiter|hiring manager|human resources|\bhr\b|careers?|staffing|hiring|campus recruiter|campus hiring|people operations|people ops|recruitment|people partner)/i;
const NON_RECRUITING_CONTEXT = /(customer support|technical support|sales|billing|privacy|legal|security|press|media|partnerships?|helpdesk|help desk|procurement|accounting|finance|account executive|customer success|marketing|operations)/i;
const LINKEDIN_PROFILE_PATTERN = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const GENERIC_IDENTITY_WORDS = new Set([
  "linkedin", "profile", "recruiter", "recruiting", "talent", "acquisition", "hiring", "manager", "technical",
  "engineering", "software", "technology", "people", "human", "resources", "careers", "career", "jobs", "job",
  "search", "results", "professional", "india", "bengaluru", "bangalore", "remote"
]);
const CONCURRENCY = 4;

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
}

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

async function fetchText(url: string, timeoutMs = 7000, headers?: Record<string, string>): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/html,text/plain,application/json,*/*;q=0.8", "user-agent": "job-agent-public-recruiter-identity/1.0", ...(headers ?? {}) } });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<string | null>): Promise<Array<string | null>> {
  const results: Array<string | null> = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function configuredSearchSources(query: string): Array<{ id: string; url: string; headers?: Record<string, string> }> {
  const configured = (process.env.PROACTIVE_RECRUITER_SEARCH_PROVIDERS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const sources = sourceList(query);
  if (!configured.length) return sources;
  const allowed = new Set(configured);
  return sources.filter((source) => allowed.has(source.id));
}

function queries(input: RecruiterDiscoveryInput): string[] {
  const company = input.companyName.trim();
  const domain = normalizeDomain(input.companyDomain);
  const title = input.jobTitle.trim() || "Frontend Developer";
  const location = input.location?.trim() || "India";
  const technology = /react|next\.js|nextjs/i.test(`${input.jobTitle} ${input.jobDescription}`) ? "React" : /typescript/i.test(input.jobDescription) ? "TypeScript" : "Frontend";
  const companyQueries = company ? [
    `site:linkedin.com/in "${company}" recruiter "${title}"`,
    `site:linkedin.com/in "${company}" recruiter`,
    `site:linkedin.com/in "${company}" "technical recruiter"`,
    `site:linkedin.com/in "${company}" "engineering recruiter"`,
    `site:linkedin.com/in "${company}" "talent acquisition"`,
    `site:linkedin.com/in "${company}" "talent partner"`,
    `site:linkedin.com/in "${company}" "hiring manager"`,
    `site:linkedin.com/in "${company}" "people partner"`,
    ...(domain ? [`site:${domain} (recruiter OR recruiting OR "talent acquisition" OR hiring)`] : []),
    `"${company}" recruiter "${title}" ${location}`
  ] : [];
  const globalQueries = [
    `site:linkedin.com/in recruiter "${title}" "${location}"`,
    `site:linkedin.com/in "technical recruiter" "${technology}" "${location}"`,
    `site:linkedin.com/in "talent acquisition" "${technology}" "${location}"`,
    `site:linkedin.com/in "talent partner" "${technology}" "${location}"`,
    `site:linkedin.com/in recruiter "React Developer" India`,
    `site:linkedin.com/in recruiter "Frontend Developer" India`,
    `site:linkedin.com/in "Senior Talent Acquisition" "${technology}" India`,
    `site:linkedin.com/in "Talent Acquisition Specialist" "${technology}" India`,
    `site:linkedin.com/in "Technical Recruiter" "${technology}" India`,
    `site:linkedin.com/in recruiter hiring "${technology}" India`
  ];
  return [...new Set([...companyQueries, ...globalQueries])];
}

function plausibleFullName(value: string | undefined): boolean {
  if (!value) return false;
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((word) => GENERIC_IDENTITY_WORDS.has(word.toLowerCase()))) return false;
  return words.every((word) => /^[A-Z][A-Za-z.'-]+$/.test(word));
}

function extractNameFromSnippet(snippet: string): string | undefined {
  const titleMatch = snippet.match(/([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*(?:-|\||:|•)\s*([^|•\n.]{3,120})/);
  if (plausibleFullName(titleMatch?.[1]?.trim())) return titleMatch?.[1]?.trim();
  const roleMatch = snippet.match(/([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:is\s+)?(?:a\s+)?(?:Senior\s+|Lead\s+|Technical\s+|Engineering\s+|Talent\s+)?(?:Recruiter|Recruiting|Talent Acquisition|Talent Partner|Hiring Manager)\b/i);
  return plausibleFullName(roleMatch?.[1]?.trim()) ? roleMatch?.[1]?.trim() : undefined;
}

function extractCompanyDomain(snippet: string, fallback: string): string | undefined {
  const domains = [...snippet.matchAll(/https?:\/\/([^\s/<>"']+)/gi)]
    .map((match) => normalizeDomain(match[1] ?? ""))
    .filter((domain) => domain && !domain.endsWith("linkedin.com") && !/google|bing|duckduckgo|qwant|yahoo|brave|mojeek|startpage|ecosia/.test(domain));
  return domains[0] ?? normalizeDomain(fallback) || undefined;
}

function parseProfiles(raw: string, input: RecruiterDiscoveryInput): RecruiterIdentityCandidate[] {
  const text = stripHtml(raw);
  const profiles = new Map<string, RecruiterIdentityCandidate>();
  for (const match of text.matchAll(LINKEDIN_PROFILE_PATTERN)) {
    const url = match[0];
    const index = match.index ?? 0;
    const snippet = text.slice(Math.max(0, index - 420), Math.min(text.length, index + 700));
    if (NON_RECRUITING_CONTEXT.test(snippet) || !RECRUITING_CONTEXT.test(snippet)) continue;
    const fullName = extractNameFromSnippet(snippet);
    if (!plausibleFullName(fullName)) continue;
    const titleMatch = snippet.match(/(?:-|\||:|•)\s*([^|•\n.]{3,120})/);
    const title = titleMatch?.[1]?.trim();
    const evidence = [snippet].filter(Boolean);
    const existing = profiles.get(url);
    profiles.set(url, {
      ...(existing ?? {}),
      email: existing?.email,
      fullName: existing?.fullName ?? fullName,
      title: existing?.title ?? title,
      department: existing?.department ?? "recruiting",
      confidence: Math.max(existing?.confidence ?? 0, 90),
      verified: false,
      verificationStatus: "identity_public_source",
      provider: "public-web",
      companyDomain: existing?.companyDomain ?? extractCompanyDomain(snippet, input.companyDomain),
      location: existing?.location ?? input.location,
      recruitingContext: title || "recruiting context found in public search evidence",
      discoveryEvidence: [...new Set([...(existing?.discoveryEvidence ?? []), ...evidence])].slice(0, 5),
      discoveredAt: existing?.discoveredAt ?? new Date(),
      linkedinProfileUrl: url,
      sources: [...(existing?.sources ?? []), { url, type: "public_linkedin_search", confidence: 90 }]
    });
  }
  return [...profiles.values()];
}

export class PublicRecruiterIdentitySearchProvider {
  readonly name = "public-web-identity";

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterIdentityCandidate[]> {
    const pages = await mapWithConcurrency(queries(input), CONCURRENCY, async (query) => {
      const responses = await Promise.all(configuredSearchSources(query).map((source) => fetchText(source.url, 7000, source.headers)));
      return responses.filter((value): value is string => Boolean(value)).join("\n");
    });
    const byUrl = new Map<string, RecruiterIdentityCandidate>();
    for (const page of pages) {
      if (!page) continue;
      for (const profile of parseProfiles(page, input)) {
        const key = profile.linkedinProfileUrl?.toLowerCase() ?? `${profile.fullName ?? "unknown"}:${profile.title ?? "recruiting"}`;
        const existing = byUrl.get(key);
        if (!existing) byUrl.set(key, profile);
        else byUrl.set(key, {
          ...existing,
          confidence: Math.max(existing.confidence ?? 0, profile.confidence ?? 0),
          companyDomain: existing.companyDomain ?? profile.companyDomain,
          sources: [...existing.sources, ...profile.sources],
          discoveryEvidence: [...new Set([...(existing.discoveryEvidence ?? []), ...(profile.discoveryEvidence ?? [])])].slice(0, 5)
        });
      }
    }
    return [...byUrl.values()];
  }
}
