const BLOCKED_HOSTS = new Set([
  // Major job boards / professional networks / ATS platforms.
  "naukri.com", "linkedin.com", "indeed.com", "glassdoor.com", "greenhouse.io", "boards.greenhouse.io", "lever.co", "jobs.lever.co",
  "ashbyhq.com", "jobs.ashbyhq.com", "myworkdayjobs.com", "workday.com", "smartrecruiters.com", "jobs.smartrecruiters.com",
  "workable.com", "apply.workable.com", "icims.com", "bamboohr.com", "taleo.net", "jobvite.com", "pinpointhq.com", "successfactors.com",
  "recruitee.com", "teamtailor.com", "personio.com", "personio.de", "jobadder.com", "rippling.com", "breezy.hr",

  // Free/public job feeds currently used by the agent. These must never become
  // employer identity merely because a feed populated company_domain with its
  // own host or because an aggregator URL is canonical.
  "weworkremotely.com", "remoteok.com", "remoteok.io", "himalayas.app", "jobicy.com", "arbeitnow.com", "arbeitnow.co.uk",
  "remotefirstjobs.com", "remoteyeah.com", "realworkfromanywhere.com", "hireweb3.io", "adzuna.com", "jooble.org", "jooble.com",
  "remotive.com", "remote.co", "workingnomads.com", "jobspresso.co", "wellfound.com", "otta.com", "dice.com", "ziprecruiter.com",
  "simplyhired.com", "careerbuilder.com", "monster.com", "builtin.com", "flexjobs.com", "jobgether.com", "cutshort.io",
  "instahyre.com", "hirist.com", "foundit.in", "timesjobs.com", "shine.com", "freshersworld.com", "apna.co", "workindia.in",
  "ycombinator.com"
]);

const CAREERS_SUBDOMAINS = /^(careers?|jobs?|job|hire|hiring|talent|recruiting|recruitment|people|hr|apply|workwithus|joinus)\./i;
const COMMON_TWO_PART_PUBLIC_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.in", "firm.in", "net.in", "org.in", "gen.in", "ind.in"]);
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.co.in", "icloud.com", "proton.me", "protonmail.com"]);
const EMAIL_PATTERN = /[A-Z0-9._+\-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

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
  jobDescription: string | null | undefined
): string | null {
  const candidates = new Map<string, number>();
  const addCandidate = (host: string | null, weight: number) => {
    if (!host) return;
    candidates.set(host, (candidates.get(host) ?? 0) + weight);
  };

  for (const email of (jobDescription ?? "").match(EMAIL_PATTERN) ?? []) {
    const domain = normalizeHost(email.split("@")[1] ?? "");
    if (domain && !GENERIC_EMAIL_DOMAINS.has(domain)) addCandidate(normalizeEmployerHost(domain), 5);
  }

  for (const url of (jobDescription ?? "").match(URL_PATTERN) ?? []) {
    addCandidate(resolveEmployerDomainFromJobUrl(url), 3);
  }

  // A canonical URL is valid employer evidence when its host is not a known
  // job board, ATS, or aggregator. The URL parser already rejects those hosts,
  // so treating a remaining direct-employer URL as strong evidence materially
  // improves coverage for feeds that omit company_domain.
  addCandidate(resolveEmployerDomainFromJobUrl(canonicalUrl), 4);
  addCandidate(resolveEmployerDomainFromJobUrl(companyDomain), 4);

  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0] ?? [null, 0];
  if (!best || bestScore < 3) return null;
  return best;
}
