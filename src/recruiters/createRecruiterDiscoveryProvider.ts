import { JobPostingRecruiterDiscoveryProvider } from "./JobPostingRecruiterDiscoveryProvider";
import { LinkedInHiringPostDiscoveryProvider } from "./LinkedInHiringPostDiscoveryProvider";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import { PublicRecruiterIdentitySearchProvider } from "./PublicRecruiterIdentitySearchProvider";
import { SnovRecruiterDiscoveryProvider } from "./SnovRecruiterDiscoveryProvider";
import {
  RecruiterContactCandidate,
  RecruiterDiscoveryContact,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterIdentityCandidate,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

export type RecruiterDiscoveryProviderId = "public-web" | "snov";

export interface RecruiterDiscoveryProviderConfig {
  provider: RecruiterDiscoveryProviderId;
  /** @deprecated Kept only for backwards-compatible callers; public-web never uses it. */
  hunterApiKey?: string;
  /** Snov credentials are required only when provider=snov. */
  snovClientId?: string;
  snovClientSecret?: string;
}

function hasEmail(contact: RecruiterDiscoveryContact): contact is RecruiterContactCandidate {
  return typeof contact.email === "string" && contact.email.trim().length > 0;
}

function identityKey(contact: RecruiterDiscoveryContact): string {
  if (contact.linkedinProfileUrl) return `profile:${contact.linkedinProfileUrl.trim().toLowerCase()}`;
  if (contact.email) return `email:${contact.email.trim().toLowerCase()}`;
  return `name:${(contact.fullName ?? "").trim().toLowerCase()}|title:${(contact.title ?? "").trim().toLowerCase()}`;
}

function mergeContacts(contacts: RecruiterDiscoveryContact[]): RecruiterDiscoveryContact[] {
  const byIdentity = new Map<string, RecruiterDiscoveryContact>();
  for (const contact of contacts) {
    const key = identityKey(contact);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, { ...contact, sources: [...(contact.sources ?? [])] });
      continue;
    }
    const existingEmail = existing.email;
    const candidateEmail = contact.email;
    const merged: RecruiterIdentityCandidate = {
      ...existing,
      email: existingEmail || candidateEmail,
      fullName: existing.fullName ?? contact.fullName,
      title: existing.title ?? contact.title,
      department: existing.department ?? contact.department,
      seniority: existing.seniority ?? contact.seniority,
      country: existing.country ?? contact.country,
      location: existing.location ?? contact.location,
      confidence: Math.max(existing.confidence ?? 0, contact.confidence ?? 0),
      verified: existing.verified || contact.verified,
      verificationStatus: existing.verified ? existing.verificationStatus : contact.verificationStatus ?? existing.verificationStatus,
      provider: existing.provider,
      linkedinProfileUrl: existing.linkedinProfileUrl ?? contact.linkedinProfileUrl,
      companyDomain: existing.companyDomain ?? contact.companyDomain,
      recruitingContext: existing.recruitingContext ?? contact.recruitingContext,
      discoveryEvidence: [...new Set([...(existing.discoveryEvidence ?? []), ...(contact.discoveryEvidence ?? [])])].slice(0, 10),
      discoveredAt: existing.discoveredAt ?? contact.discoveredAt,
      sources: [...existing.sources, ...(contact.sources ?? [])]
    };
    byIdentity.set(key, merged);
  }
  return [...byIdentity.values()];
}

function identityCandidatesToContacts(candidates: RecruiterIdentityCandidate[]): RecruiterDiscoveryContact[] {
  return candidates.map((candidate) => ({
    ...candidate,
    provider: "public-web-identity",
    verified: false,
    verificationStatus: candidate.verificationStatus ?? "identity_public_source",
    sources: [...(candidate.sources ?? [])]
  }));
}

/**
 * Free-first layered recruiter discovery.
 *
 * The public hiring-post layer is intentionally separate from job-page
 * discovery: social hiring posts are evidence about the person/company
 * recruiting for a role, and can contain a public email, LinkedIn identity,
 * location, experience and skill requirements that a job page does not expose.
 */
class LayeredPublicRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "public-web";
  private readonly identitySearch = new PublicRecruiterIdentitySearchProvider();
  private readonly hiringPostSearch = new LinkedInHiringPostDiscoveryProvider();

  constructor(
    private readonly firstParty = new JobPostingRecruiterDiscoveryProvider(),
    private readonly publicSearch = new PublicRecruiterSearchProvider()
  ) {}

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const [firstPartyResult, publicSearchResult, identityCandidates, hiringPostResult] = await Promise.all([
      this.firstParty.discover(input),
      this.publicSearch.discover(input),
      this.identitySearch.discover(input),
      this.hiringPostSearch.discover(input)
    ]);
    return {
      provider: this.name,
      contacts: mergeContacts([
        ...firstPartyResult.contacts,
        ...publicSearchResult.contacts,
        ...identityCandidatesToContacts(identityCandidates),
        ...hiringPostResult.contacts
      ]),
      discoveredAt: new Date(),
      metrics: {
        ...(publicSearchResult.metrics ?? {}),
        rawPages: (publicSearchResult.metrics?.rawPages ?? 0) + (hiringPostResult.metrics?.rawPages ?? 0),
        uniqueUrls: (publicSearchResult.metrics?.uniqueUrls ?? 0) + (hiringPostResult.metrics?.uniqueUrls ?? 0),
        linkedinUrls: (publicSearchResult.metrics?.linkedinUrls ?? 0) + (hiringPostResult.metrics?.linkedinUrls ?? 0),
        recruiterCandidates: (publicSearchResult.metrics?.recruiterCandidates ?? 0) + (hiringPostResult.metrics?.recruiterCandidates ?? 0)
      }
    };
  }

  async discoverEmails(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const [firstPartyResult, publicSearchResult, hiringPostResult] = await Promise.all([
      this.firstParty.discover(input),
      this.publicSearch.discover(input),
      this.hiringPostSearch.discoverEmails(input)
    ]);
    return {
      provider: this.name,
      contacts: mergeContacts([
        ...firstPartyResult.contacts.filter(hasEmail),
        ...publicSearchResult.contacts.filter(hasEmail),
        ...hiringPostResult.contacts.filter(hasEmail)
      ]),
      discoveredAt: new Date(),
      metrics: {
        ...(publicSearchResult.metrics ?? {}),
        rawPages: (publicSearchResult.metrics?.rawPages ?? 0) + (hiringPostResult.metrics?.rawPages ?? 0),
        uniqueUrls: (publicSearchResult.metrics?.uniqueUrls ?? 0) + (hiringPostResult.metrics?.uniqueUrls ?? 0),
        linkedinUrls: (publicSearchResult.metrics?.linkedinUrls ?? 0) + (hiringPostResult.metrics?.linkedinUrls ?? 0),
        recruiterCandidates: (publicSearchResult.metrics?.recruiterCandidates ?? 0) + (hiringPostResult.metrics?.recruiterCandidates ?? 0)
      }
    };
  }

  verify(email: string): Promise<RecruiterVerificationResult> {
    return this.publicSearch.verify(email);
  }
}

export function createRecruiterDiscoveryProvider(config: RecruiterDiscoveryProviderConfig): RecruiterDiscoveryProvider {
  if (config.provider === "snov") {
    const configClientId = config.snovClientId?.trim();
    const configClientSecret = config.snovClientSecret?.trim();

    if (configClientId || configClientSecret) {
      if (!configClientId || !configClientSecret) {
        throw new Error("Snov recruiter discovery requires SNOV_CLIENT_ID and SNOV_CLIENT_SECRET.");
      }
      return new SnovRecruiterDiscoveryProvider({ clientId: configClientId, clientSecret: configClientSecret });
    }

    const clientId = process.env.SNOV_CLIENT_ID?.trim();
    const clientSecret = process.env.SNOV_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new Error("Snov recruiter discovery requires SNOV_CLIENT_ID and SNOV_CLIENT_SECRET.");
    }
    return new SnovRecruiterDiscoveryProvider({ clientId, clientSecret });
  }
  return new LayeredPublicRecruiterDiscoveryProvider();
}
