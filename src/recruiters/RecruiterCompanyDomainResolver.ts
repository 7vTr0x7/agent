const BLOCKED_HOSTS = new Set([
  "naukri.com", "linkedin.com", "indeed.com", "glassdoor.com", "greenhouse.io", "boards.greenhouse.io", "lever.co", "jobs.lever.co",
  "ashbyhq.com", "jobs.ashbyhq.com", "myworkdayjobs.com", "workday.com", "smartrecruiters.com", "jobs.smartrecruiters.com",
  "workable.com", "apply.workable.com", "icims.com", "bamboohr.com", "taleo.net", "jobvite.com", "pinpointhq.com", "successfactors.com",
  "recruitee.com", "teamtailor.com", "personio.com", "personio.de", "jobadder.com", "rippling.com", "breezy.hr"
]);
const CAREERS_SUBDOMAINS = /^(careers?|jobs?|job|hire|hiring|talent|recruiting|recruitment|people|hr|apply|workwithus|joinus)\./i;
const COMMON_TWO_PART_PUBLIC_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.in", "firm.in", "net.in", "org.in", "gen.in", "ind.in"]);

function registrableHost(hostname: string): string {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  const suffix = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (COMMON_TWO_PART_PUBLIC_SUFFIXES.has(suffix) && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

export function resolveEmployerDomainFromJobUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    let hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.includes("localhost")) return null;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
    hostname = hostname.replace(CAREERS_SUBDOMAINS, "");
    return registrableHost(hostname);
  } catch {
    return null;
  }
}
