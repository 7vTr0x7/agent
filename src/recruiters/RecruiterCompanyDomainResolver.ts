const BLOCKED_HOSTS = new Set([
  "naukri.com", "linkedin.com", "indeed.com", "glassdoor.com", "greenhouse.io", "boards.greenhouse.io", "lever.co", "jobs.lever.co",
  "ashbyhq.com", "jobs.ashbyhq.com", "myworkdayjobs.com", "workday.com", "smartrecruiters.com", "jobs.smartrecruiters.com",
  "workable.com", "apply.workable.com", "icims.com", "bamboohr.com", "taleo.net", "jobvite.com", "pinpointhq.com", "successfactors.com",
  "recruitee.com", "teamtailor.com", "personio.com", "personio.de", "jobadder.com", "rippling.com", "breezy.hr",
  "weworkremotely.com", "remoteok.com", "remoteok.io", "himalayas.app", "jobicy.com", "arbeitnow.com", "arbeitnow.co.uk",
  "remotefirstjobs.com", "remoteyeah.com", "realworkfromanywhere.com", "hireweb3.io", "adzuna.com", "jooble.org", "jooble.com",
  "remotive.com", "remote.co", "workingnomads.com", "jobspresso.co", "wellfound.com", "otta.com", "dice.com", "ziprecruiter.com",
  "simplyhired.com", "careerbuilder.com", "monster.com", "builtin.com", "flexjobs.com", "jobgether.com", "cutshort.io",
  "instahyre.com", "hirist.com", "foundit.in", "timesjobs.com", "shine.com", "freshersworld.com", "apna.co", "workindia.in",
  "ycombinator.com"
]);

const CAREERS_SUBDOMAINS = /^(careers?|jobs?|job|hire|hiring|talent|recruiting|recruitment|people|hr|apply|workwithus|joinus)\./i;
const COMMON_TWO_PART_PUBLIC_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.au", "org.au", "co.in", "firm.in", "net.in", "org.in", "gen.in", "ind.in"]);
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.co.in", "icloud.com", "proton.me", "protonmail.com"]);
const EMAIL_PATTERN = /[A-Z0-9._+\-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const SEARCH_URL_PATTERN = /https?:\/\/[^\s<>"'()]+/gi;

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function registrableDomain(hostname: string): string {
  const host = normalizeHost(hostname).replace(/\.$/, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const suffix = labels.slice(-2).join(".");
  if (COMMON_TWO_PART_PUBLIC_SUFFIXES.has(suffix)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

function normalizeEmployerHost(value: string): string | null {
  const normalized = normalizeHost(value).replace(/\/$/, "");
  if (!normalized || normalized === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return null;
  if (BLOCKED_HOSTS.has(normalized)) return null;
  if (CAREERS_SUBDOMAINS.test(normalized)) return registrableDomain(normalized);
  const registrable = registrableDomain(normalized);
  if (BLOCKED_HOSTS.has(registrable)) return null;
  if (GENERIC_EMAIL_DOMAINS.has(registrable)) return null;
  return registrable;
}

export function isBlockedEmployerDomain(value: string | null | undefined): boolean {
  const host = normalizeHost(value ?? "");
  return !!host && (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(registrableDomain(host)));
}

export function resolveEmployerDomainFromJobUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    return normalizeEmployerHost(url.hostname);
  } catch {
    return null;
  }
}

export function resolveEmployerDomainFromJobData(
  companyDomain: string | null | undefined,
  canonicalUrl: string | null | undefined,
  _jobDescription: string | null | undefined
): string | null {
  // Only explicit employer-domain data and the canonical job URL are trusted
  // as deterministic evidence. Domains mentioned in descriptions are not
  // authoritative: job postings routinely contain ATS, vendor, partner,
  // analytics, portfolio, and unrelated contact domains. When these primary
  // signals are unavailable, callers must use public employer-search
  // resolution rather than guessing from description links or emails.
  const explicitDomain = resolveEmployerDomainFromJobUrl(companyDomain);
  if (explicitDomain) return explicitDomain;
  return resolveEmployerDomainFromJobUrl(canonicalUrl);
}

function companyTokens(companyName: string): string[] {
  return companyName.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !["the", "and", "inc", "ltd", "llc", "corp", "company", "limited", "private", "pvt"].includes(token));
}

function domainMatchesCompany(domain: string, companyName: string): boolean {
  const tokens = companyTokens(companyName);
  if (tokens.length === 0) return false;
  const host = domain.split(".")[0] ?? domain;
  return tokens.some((token) => host.includes(token));
}

async function fetchSearchResult(query: string, engine: "google" | "bing" | "duckduckgo"): Promise<string | null> {
  const encoded = encodeURIComponent(query);
  const urls = {
    google: `https://r.jina.ai/https://www.google.com/search?q=${encoded}&gbv=1`,
    bing: `https://r.jina.ai/https://www.bing.com/search?q=${encoded}`,
    duckduckgo: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encoded}`
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(urls[engine], { signal: controller.signal, redirect: "follow", headers: { accept: "text/plain,text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": "job-agent-employer-domain-resolver/1.0" } });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function domainsFromSearchText(text: string, companyName: string): string[] {
  const found = new Set<string>();
  for (const rawUrl of text.match(SEARCH_URL_PATTERN) ?? []) {
    try {
      const url = new URL(rawUrl);
      const domain = normalizeEmployerHost(url.hostname);
      if (!domain || !domainMatchesCompany(domain, companyName)) continue;
      found.add(domain);
    } catch {
      // Ignore malformed search-result URLs.
    }
  }
  return [...found];
}

/**
 * Last-resort employer resolution for feeds that provide only a company name.
 * The resolver is intentionally conservative: a domain must be a plausible
 * company domain and appear in at least two independent public search-engine
 * result pages. It never falls back to a guessed domain or a job-board host.
 */
export async function resolveEmployerDomainFromPublicSearch(companyName: string): Promise<string | null> {
  const name = companyName.trim();
  if (!name || name.length < 2) return null;

  const query = `"${name}" official website`;
  const results = await Promise.all([
    fetchSearchResult(query, "google"),
    fetchSearchResult(query, "bing"),
    fetchSearchResult(query, "duckduckgo")
  ]);
  const counts = new Map<string, number>();
  for (const result of results) {
    if (!result) continue;
    for (const domain of domainsFromSearchText(result, name)) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}
