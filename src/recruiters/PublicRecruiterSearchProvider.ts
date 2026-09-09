import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

// Deliberately exclude '%' from the local part. Percent is technically valid in
// RFC email syntax, but search-engine URLs commonly contain percent-encoded
// query text such as %22company%22%20%22@company.com, which must never become a
// recruiter contact.
const EMAIL_PATTERN = /[A-Z0-9._+\-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RECRUITING_CONTEXT = /(recruiter|recruiting|talent acquisition|talent partner|technical recruiter|hiring manager|human resources|\bhr\b|careers?|staffing|hiring)/i;
const NON_RECRUITING_CONTEXT = /(customer support|technical support|sales|billing|privacy|legal|security|press|media|partnerships?|helpdesk|help desk)/i;
const LINKEDIN_PROFILE_PATTERN = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
}

function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function emailContext(text: string, index: number): string {
  const start = Math.max(0, index - 280);
  const end = Math.min(text.length, index + 280);
  return text.slice(start, end);
}

function isCompanyEmail(email: string, domain: string): boolean {
  return normalizeEmail(email).endsWith(`@${domain}`);
}

export function isPlausibleRecruiterEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const localPart = normalized.split("@")[0] ?? "";

  if (/%[0-9a-f]{2}/i.test(normalized)) return false;
  if (/^[^@]+%[^@]*@/i.test(normalized)) return false;
  if (!/^[a-z0-9][a-z0-9._+\-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return false;

  // Search engines sometimes expose fragments of URL/query text immediately
  // before @company.com (for example, `%22` becoming `22@company.com`). A
  // numeric-only local part is not useful recruiter evidence, so reject it.
  if (/^\d+$/.test(localPart)) return false;

  // Reject malformed dot placement and empty-looking local parts.
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) return false;
  return true;
}

function extractEmails(text: string, domain: string): string[] {
  const normalized = stripHtml(text ?? "");
  const found = new Set<string>();
  for (const match of normalized.matchAll(EMAIL_PATTERN)) {
    const email = normalizeEmail(match[0] ?? "");
    if (!email || !isPlausibleRecruiterEmail(email) || !isCompanyEmail(email, domain)) continue;
    const context = emailContext(normalized, match.index ?? 0);
    if (NON_RECRUITING_CONTEXT.test(context)) continue;
    if (RECRUITING_CONTEXT.test(context)) found.add(email);
  }
  return [...found];
}

function extractLinkedInProfiles(text: string): string[] {
  return [...new Set(text.match(LINKEDIN_PROFILE_PATTERN) ?? [])].slice(0, 10);
}

function searchUrls(query: string): string[] {
  const encoded = encodeURIComponent(query);
  return [
    `https://r.jina.ai/https://www.google.com/search?q=${encoded}&gbv=1`,
    `https://r.jina.ai/https://www.bing.com/search?q=${encoded}`,
    `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encoded}`
  ];
}

async function fetchText(url: string, timeoutMs = 9000): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/plain,text/html,application/xhtml+xml,*/*;q=0.8",
        "user-agent": "job-agent-public-recruiter-discovery/4.2"
      }
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildQueries(input: RecruiterDiscoveryInput): string[] {
  const company = input.companyName.trim();
  const domain = normalizeDomain(input.companyDomain);
  const title = input.jobTitle.trim();
  return [
    `site:linkedin.com/in "${company}" "${title}" recruiter`,
    `site:linkedin.com/in "${company}" recruiter Bengaluru`,
    `site:linkedin.com/in "${company}" "talent acquisition" India`,
    `"${company}" "@${domain}" recruiter`,
    `"${company}" "@${domain}" "talent acquisition"`,
    `"${company}" "@${domain}" "technical recruiter"`,
    `"${company}" "@${domain}" "hiring manager"`,
    `"${company}" recruiter "${title}" India`
  ];
}

export class PublicRecruiterSearchProvider implements RecruiterDiscoveryProvider {
  readonly name = "public-web";

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const domain = normalizeDomain(input.companyDomain);
    const contacts = new Map<string, RecruiterContactCandidate>();
    const pages: string[] = [];

    for (const query of buildQueries(input)) {
      const responses = await Promise.all(searchUrls(query).map((url) => fetchText(url)));
      for (const response of responses) if (response) pages.push(response);
    }

    for (const page of pages) {
      const text = stripHtml(page);
      for (const email of extractEmails(text, domain)) {
        const existing = contacts.get(email);
        const linkedin = extractLinkedInProfiles(text).find((url) => text.toLowerCase().includes(url.toLowerCase()));
        if (existing) {
          existing.confidence = Math.min(100, (existing.confidence ?? 0) + 2);
          existing.sources.push({ type: "public_search_result", confidence: 92 });
          if (!existing.linkedinProfileUrl && linkedin) existing.linkedinProfileUrl = linkedin;
          continue;
        }
        contacts.set(email, {
          email,
          title: "Recruiting contact from public search result",
          department: "recruiting",
          confidence: linkedin ? 97 : 92,
          verified: false,
          verificationStatus: "unverified_public_source",
          provider: this.name,
          linkedinProfileUrl: linkedin,
          sources: [{ type: "public_search_result", confidence: 92 }]
        });
      }
    }

    return {
      provider: this.name,
      contacts: [...contacts.values()].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
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
