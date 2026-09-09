const BLOCKED_HOSTS = new Set([
  "naukri.com", "linkedin.com", "indeed.com", "glassdoor.com", "greenhouse.io", "boards.greenhouse.io", "lever.co", "jobs.lever.co",
  "ashbyhq.com", "jobs.ashbyhq.com", "myworkdayjobs.com", "workday.com", "smartrecruiters.com", "jobs.smartrecruiters.com",
  "workable.com", "apply.workable.com", "icims.com", "bamboohr.com", "taleo.net", "jobvite.com", "pinpointhq.com", "successfactors.com",
  "recruitee.com", "teamtailor.com", "personio.com", "personio.de", "jobadder.com", "rippling.com", "breezy.hr"
]);
const CAREERS_SUBDOMAINS = /^(careers?|jobs?|job|hire|hiring|talent|recruiting|recruitment|people|hr|apply|workwithus|joinus)\./i;
const COMMON_TWO_PART_PUBLIC_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.in", "firm.in", "net.in", "org.in", "gen.in", "ind.in"]);
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.co.in", "icloud.com", "proton.me", "protonmail.com"]);
const EMAIL_PATTERN = /[A-Z0-9._+\-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

function registrableHost(hostname: string): string {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  const suffix = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (COMMON_TWO_PART_PUBLIC_SUFFIXES.has(suffix) && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

function normalizeEmployerHost(hostname: string): string | null {
  let normalized = hostname.trim().toLowerCase().replace(/^www\./, "");
  if (!normalized || !normalized.includes(".") || BLOCKED_HOSTS.has(normalized) || normalized.includes("localhost")) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return null;
  normalized = normalized.replace(CAREERS_SUBDOMAINS, "");
  const registrable = registrableHost(normalized);
  if (!registrable || BLOCKED_HOSTS.has(registrable) || GENERIC_EMAIL_DOMAINS.has(registrable)) return null;
  return registrable;
}

export function resolveEmployerDomainFromJobUrl(value: string): string | null {
  try {
    const raw = value.trim();
    if (!raw) return null;
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return normalizeEmployerHost(url.hostname);
  } catch {
    return null;
  }
}

/**
 * Resolve an employer domain using evidence already present in a job.
 * Explicit employer-domain emails/links in the public job description are
 * stronger evidence than an aggregator/ATS canonical URL. We never guess a
 * domain from the company name alone.
 */
export function resolveEmployerDomainFromJobData(
  companyDomain: string | null | undefined,
  canonicalUrl: string,
  jobDescription: string
): string | null {
  const candidates = new Map<string, number>();
  const add = (domain: string | null, weight: number): void => {
    if (!domain) return;
    candidates.set(domain, (candidates.get(domain) ?? 0) + weight);
  };

  const normalizedDescription = jobDescription ?? "";
  for (const match of normalizedDescription.matchAll(EMAIL_PATTERN)) {
    const emailDomain = match[0]?.split("@")[1]?.toLowerCase();
    if (!emailDomain || GENERIC_EMAIL_DOMAINS.has(emailDomain)) continue;
    add(normalizeEmployerHost(emailDomain), 5);
  }

  for (const match of normalizedDescription.matchAll(URL_PATTERN)) {
    add(resolveEmployerDomainFromJobUrl(match[0]), 3);
  }

  add(resolveEmployerDomainFromJobUrl(companyDomain ?? ""), 4);

  // A canonical URL is only useful as employer-domain evidence when its host
  // is not a known job board/ATS. Generic job-board domains must never become
  // the employer domain merely because no stronger employer evidence exists.
  add(resolveEmployerDomainFromJobUrl(canonicalUrl), 1);

  // Do not infer an employer from an aggregator-only canonical URL. A domain
  // discovered solely from canonicalUrl has only the weakest evidence and is
  // not sufficient to establish employer identity.
  let bestDomain: string | null = null;
  let bestScore = -1;
  for (const [domain, score] of candidates) {
    if (score > bestScore) {
      bestDomain = domain;
      bestScore = score;
    }
  }

  if (bestScore < 3) return null;
  return bestDomain;
}
