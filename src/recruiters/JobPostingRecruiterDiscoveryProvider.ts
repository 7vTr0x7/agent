import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RECRUITING_CONTEXT = /(recruiter|recruiting|talent|hiring|human\s*resources|\bhr\b|people\s*team|careers|staffing|jobs?\s+team|join\s+us)/i;
const NON_RECRUITING_CONTEXT = /(technical\s+questions?|engineering\s+questions?|customer\s+support|technical\s+support|support\s+questions?|sales|billing|privacy|legal|security)/i;
const PUBLIC_PATHS = ["/", "/careers", "/career", "/jobs", "/join-us", "/contact"] as const;

function normalizeDomain(value: string): string { return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? ""; }
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function isCompanyEmail(email: string, domain: string): boolean { return normalizeEmail(email).split("@")[1] === domain; }

function contextAround(text: string, index: number): string {
  const sentenceStart = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf("\n", index - 1)) + 1;
  const sentenceEndCandidates = [text.indexOf(".", index), text.indexOf("!", index), text.indexOf("?", index), text.indexOf("\n", index)].filter((position) => position !== -1);
  const sentenceEnd = sentenceEndCandidates.length > 0 ? Math.min(...sentenceEndCandidates) : text.length;
  return text.slice(sentenceStart, sentenceEnd);
}

export function extractExplicitRecruiterEmails(jobDescription: string, companyDomain: string): string[] { return extractRecruiterEmailsFromPublicText(jobDescription, companyDomain); }

function extractRecruiterEmailsFromPublicText(text: string, companyDomain: string): string[] {
  const domain = normalizeDomain(companyDomain);
  if (!domain) return [];
  const found = new Set<string>();
  for (const match of [...(text ?? "").matchAll(EMAIL_PATTERN)]) {
    const value = match[0]; const index = match.index ?? -1;
    if (!value || index < 0) continue;
    const email = normalizeEmail(value);
    if (!isCompanyEmail(email, domain)) continue;
    const context = contextAround(text, index);
    if (NON_RECRUITING_CONTEXT.test(context) || !RECRUITING_CONTEXT.test(context)) continue;
    found.add(email);
  }
  return [...found];
}

async function fetchPublicCompanyPages(companyDomain: string): Promise<string[]> {
  const domain = normalizeDomain(companyDomain);
  if (!domain) return [];
  const requests = PUBLIC_PATHS.map(async (path) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch(`https://${domain}${path}`, {
        signal: controller.signal,
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": "job-agent-public-recruiter-discovery/1.0" }
      });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });
  return (await Promise.all(requests)).filter((value): value is string => Boolean(value));
}

export class JobPostingRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "job-posting";

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const sources = [input.jobDescription, ...(await fetchPublicCompanyPages(input.companyDomain))];
    const emails = new Set<string>();
    for (const source of sources) for (const email of extractRecruiterEmailsFromPublicText(source, input.companyDomain)) emails.add(email);

    const contacts: RecruiterContactCandidate[] = [...emails].map((email) => ({
      email,
      title: "Recruiting contact from public company source",
      department: "recruiting",
      confidence: 100,
      verified: false,
      verificationStatus: "unverified_public_source",
      provider: this.name,
      sources: [{ type: "job_posting" }, { type: "public_company_page" }]
    }));

    return { provider: this.name, contacts, discoveredAt: new Date() };
  }

  async verify(email: string): Promise<RecruiterVerificationResult> { return { email: normalizeEmail(email), verified: false, status: "verification_provider_required", confidence: 0 }; }
}
