const BLOCKED_HOSTS = new Set([
  "naukri.com",
  "www.naukri.com",
  "linkedin.com",
  "www.linkedin.com",
  "indeed.com",
  "www.indeed.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "greenhouse.io",
  "boards.greenhouse.io",
  "lever.co",
  "jobs.lever.co",
  "ashbyhq.com",
  "jobs.ashbyhq.com",
  "myworkdayjobs.com",
  "workday.com",
  "smartrecruiters.com",
  "jobs.smartrecruiters.com",
  "workable.com",
  "apply.workable.com",
  "icims.com",
  "bamboohr.com",
  "taleo.net",
  "jobvite.com",
  "pinpointhq.com",
  "successfactors.com"
]);

export function resolveEmployerDomainFromJobUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.includes("localhost")) return null;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;

    return hostname;
  } catch {
    return null;
  }
}
