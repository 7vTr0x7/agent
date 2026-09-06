import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RECRUITING_CONTEXT = /(recruiter|recruiting|talent|hiring|human\s*resources|\bhr\b|people\s*team|careers|staffing)/i;
const NON_RECRUITING_CONTEXT = /(technical\s+questions?|engineering\s+questions?|customer\s+support|technical\s+support|support\s+questions?)/i;

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
  const sentenceStart = Math.max(
    text.lastIndexOf(".", index - 1),
    text.lastIndexOf("!", index - 1),
    text.lastIndexOf("?", index - 1),
    text.lastIndexOf("\n", index - 1)
  ) + 1;
  const sentenceEndCandidates = [
    text.indexOf(".", index),
    text.indexOf("!", index),
    text.indexOf("?", index),
    text.indexOf("\n", index)
  ].filter((position) => position !== -1);
  const sentenceEnd = sentenceEndCandidates.length > 0 ? Math.min(...sentenceEndCandidates) : text.length;
  return text.slice(sentenceStart, sentenceEnd);
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

    const context = contextAround(text, index);
    if (NON_RECRUITING_CONTEXT.test(context)) continue;
    if (!RECRUITING_CONTEXT.test(context)) continue;

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
