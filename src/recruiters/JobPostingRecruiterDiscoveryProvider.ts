import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RECRUITING_CONTEXT = /(recruit|talent|hiring|human\s*resources|\bhr\b|people\s*team|careers|staffing)/i;

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isCompanyEmail(email: string, domain: string): boolean {
  return normalizeEmail(email).split("@")[1] === domain;
}

function contextAround(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineEndIndex = text.indexOf("\n", index);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  return text.slice(lineStart, lineEnd);
}

export function extractExplicitRecruiterEmails(jobDescription: string, companyDomain: string): string[] {
  const domain = normalizeDomain(companyDomain);
  if (!domain) return [];

  const text = jobDescription ?? "";
  const matches = [...text.matchAll(EMAIL_PATTERN)];
  const found = new Set<string>();

  for (const match of matches) {
    const value = match[0];
    const index = match.index ?? -1;
    if (index < 0) continue;
    const email = normalizeEmail(value);
    if (!isCompanyEmail(email, domain)) continue;
    if (!RECRUITING_CONTEXT.test(contextAround(text, index))) continue;
    found.add(email);
  }

  return [...found];
}

export class JobPostingRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "job-posting";

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const contacts: RecruiterContactCandidate[] = extractExplicitRecruiterEmails(
      input.jobDescription,
      input.companyDomain
    ).map((email) => ({
      email,
      title: "Recruiting contact from job posting",
      department: "recruiting",
      confidence: 100,
      // An explicit public address is evidence of relevance, not proof of deliverability.
      // A real verifier must upgrade this before outbound use.
      verified: false,
      verificationStatus: "unverified_public_source",
      provider: this.name,
      sources: [{ type: "job_posting" }]
    }));

    return {
      provider: this.name,
      contacts,
      discoveredAt: new Date()
    };
  }

  async verify(email: string): Promise<RecruiterVerificationResult> {
    return {
      email: normalizeEmail(email),
      verified: false,
      status: "verification_provider_required",
      confidence: 0
    };
  }
}
