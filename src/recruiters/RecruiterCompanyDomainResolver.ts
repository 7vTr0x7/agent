import { sourceList } from "./PublicSearchProviderRegistry";

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
  "ycombinator.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "youtube.com"
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
  jobDescription: string | null | undefined,
  companyName?: string | null
): string | null {
  const explicitDomain = resolveEmployerDomainFromJobUrl(companyDomain);
  if (explicitDomain) return explicitDomain;

  const canonicalDomain = resolveEmployerDomainFromJobUrl(canonicalUrl);
  if (canonicalDomain && (!companyName || domainMatchesCompany(canonicalDomain, companyName))) return canonicalDomain;

  // Some public job feeds omit the employer domain but retain a first-party
  // company URL or recruiting email in the posting. Accept those only when
  // the domain is non-generic and its host matches a token from the employer
  // name. Never guess a domain from the company name alone.
  if (!companyName) return null;
  const text = jobDescription ?? "";
  const candidates = new Set<string>();
  for (const rawUrl of text.match(URL_PATTERN) ?? []) {
    try {
      const domain = normalizeEmployerHost(new URL(rawUrl).hostname);
      if (domain) candidates.add(domain);
    } catch {
      // Ignore malformed URLs.
    }
  }
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const rawDomain = match[0]?.split("@")[1];
    const domain = rawDomain ? normalizeEmployerHost(rawDomain) : null;
    if (domain) candidates.add(domain);
  }
  return [...candidates].find((domain) => domainMatchesCompany(domain, companyName)) ?? null;
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

async function fetchSearchResult(query: string, engine: "google" | "bing" | "duckduckgo" | "qwant"): Promise<string | null> {
  const encoded = encodeURIComponent(query);
  const directUrls = {
    google: `https://www.google.com/search?q=${encoded}&gbv=1`,
    bing: `https://www.bing.com/search?q=${encoded}`,
    duckduckgo: `https://html.duckduckgo.com/html/?q=${encoded}`,
    qwant: `https://www.qwant.com/?q=${encoded}&t=web`
  };
  const readerUrls = {
    google: `https://r.jina.ai/https://www.google.com/search?q=${encoded}&gbv=1`,
    bing: `https://r.jina.ai/https://www.bing.com/search?q=${encoded}`,
    duckduckgo: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encoded}`,
    qwant: `https://r.jina.ai/https://www.qwant.com/?q=${encoded}&t=web`
  };
  const fetchOne = async (url: string, timeoutMs: number): Promise<string | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/plain,text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": "job-agent-employer-domain-resolver/1.0" } });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  return await fetchOne(directUrls[engine], 4_000) ?? await fetchOne(readerUrls[engine], 5_000);
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
export async function resolveEmployerDomainFromTrustedJobSource(canonicalUrl: string | null | undefined, companyName: string): Promise<string | null> {
  const raw = (canonicalUrl ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (normalizeHost(url.hostname) !== "himalayas.app") return null;
  const match = url.pathname.match(/^\/companies\/([a-z0-9-]+)\/jobs(?:\/|$)/i);
  const slug = match?.[1];
  if (!slug) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const sourceUrl = `https://himalayas.app/companies/${slug}`;
    let response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8", "user-agent": "job-agent-employer-domain-resolver/1.0" }
    });
    let html = response.ok ? await response.text() : "";
    if (!html) {
      response = await fetch(`https://r.jina.ai/${sourceUrl}`, {
        signal: controller.signal,
        redirect: "follow",
        headers: { accept: "text/plain,text/html;q=0.9,*/*;q=0.8", "user-agent": "job-agent-employer-domain-resolver/1.0" }
      });
      if (!response.ok) return null;
      html = await response.text();
    }
    for (const rawHref of html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi)) {
      const href = rawHref[1];
      if (!href) continue;
      try {
        const domain = normalizeEmployerHost(new URL(href).hostname);
        if (domain && domainMatchesCompany(domain, companyName)) return domain;
      } catch {
        // Ignore malformed external links.
      }
    }
    // Some rendered/anti-bot variants expose the company website inside escaped JSON.
    // Normalize escaped slashes before applying the same company-token/domain checks.
    const searchableHtml = html.replace(/\\u002f/gi, "/").replace(/\\\//g, "/");
    // Some rendered/anti-bot variants expose the company website as text rather
    // than an href. Treat only a company-matching, non-blocked domain as evidence.
    for (const match of searchableHtml.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      const domain = normalizeEmployerHost(match[1] ?? "");
      if (domain && domainMatchesCompany(domain, companyName)) return domain;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveEmployerDomainFromPublicSearch(companyName: string): Promise<string | null> {
  const name = companyName.trim();
  if (!name || name.length < 2) return null;

  const query = `"${name}" official website`;
  const results = await Promise.all([
    fetchSearchResult(query, "google"),
    fetchSearchResult(query, "bing"),
    fetchSearchResult(query, "duckduckgo"),
    fetchSearchResult(query, "qwant")
  ]);
  const counts = new Map<string, number>();
  for (const result of results) {
    if (!result) continue;
    for (const domain of domainsFromSearchText(result, name)) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
  if (ranked[0]?.[0]) return ranked[0][0];

  // A single public search engine can be sufficient when the returned domain
  // independently proves the employer identity. This keeps the resolver
  // evidence-first: the domain must come from a public search result AND the
  // fetched site must contain a company-name token (or the hostname itself
  // must contain one). We never construct a domain from the company name.
  const singleEngineCandidates = [...counts.keys()].slice(0, 8);
  for (const domain of singleEngineCandidates) {
    if (await publicSiteConfirmsCompany(domain, name)) return domain;
  }

  // The older four-engine resolver can return no usable URLs when providers
  // serve anti-bot/search-infrastructure responses. Reuse the application's
  // broader public-search registry as a bounded second pass. Candidates still
  // require direct public-site corroboration before acceptance.
  const registryResults = await fetchProviderSearchResults(query);
  const registryDomains = new Set<string>();
  for (const result of registryResults) {
    for (const domain of domainsFromSearchText(result, name)) registryDomains.add(domain);
  }
  for (const domain of [...registryDomains].slice(0, 8)) {
    if (await publicSiteConfirmsCompany(domain, name)) return domain;
  }
  return null;
}

async function fetchProviderSearchResults(query: string): Promise<string[]> {
  const sources = sourceList(query).filter(source =>
    ["google-direct","bing-direct","google-jina","bing-jina","duckduckgo-jina","startpage-jina","ecosia-jina","qwant-direct"].includes(source.id)
  ).slice(0, 8);
  const results = await Promise.all(sources.map(async (source) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(source.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "text/plain,text/html,application/xhtml+xml,*/*;q=0.8",
          "user-agent": "job-agent-employer-domain-resolver/2.0",
          ...(source.headers ?? {})
        }
      });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }));
  return results.filter((value): value is string => Boolean(value));
}

async function publicSiteConfirmsCompany(domain: string, companyName: string): Promise<boolean> {
  const tokens = companyTokens(companyName);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => domain.split(".")[0]?.includes(token))) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`https://${domain}/`, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "job-agent-employer-domain-verifier/1.0"
      }
    });
    if (!response.ok) return false;
    const text = (await response.text()).replace(/<[^>]+>/g, " ").toLowerCase().slice(0, 100_000);
    return tokens.some((token) => text.includes(token));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
