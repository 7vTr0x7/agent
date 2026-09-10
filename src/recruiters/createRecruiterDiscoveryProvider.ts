import { JobPostingRecruiterDiscoveryProvider } from "./JobPostingRecruiterDiscoveryProvider";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import { PublicRecruiterIdentitySearchProvider } from "./PublicRecruiterIdentitySearchProvider";
import {
  RecruiterContactCandidate,
  RecruiterDiscoveryContact,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterIdentityCandidate,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

export type RecruiterDiscoveryProviderId = "public-web";

export interface RecruiterDiscoveryProviderConfig {
  provider: RecruiterDiscoveryProviderId;
  /** @deprecated Kept only for backwards-compatible callers; public-web never uses it. */
  hunterApiKey?: string;
  /** @deprecated Kept only for backwards-compatible callers; public-web never uses them. */
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
      provider: "public-web",
      linkedinProfileUrl: existing.linkedinProfileUrl ?? contact.linkedinProfileUrl,
      companyDomain: existing.companyDomain ?? contact.companyDomain,
      recruitingContext: existing.recruitingContext ?? contact.recruitingContext,
      discoveryEvidence: [...new Set([...(existing.discoveryEvidence ?? []), ...(contact.discoveryEvidence ?? [])])].slice(0, 10),
      discoveredAt: existing.discoveredAt ?? contact.discoveredAt,
      sources: [...existing.sources, ...(contact.sources ?? [])]
    };
    byIdentity.set(key, hasEmail(merged) ? merged : merged);
  }
  return [...byIdentity.values()];
}

/**
 * Free-first layered recruiter discovery.
 *
 * Identity discovery is deliberately independent from email discovery. A
 * recruiter profile remains a first-class result even when no public email is
 * available. Existing public email providers remain the email-enrichment layer.
 */
class LayeredPublicRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "public-web";

  constructor(
    private readonly firstParty = new JobPostingRecruiterDiscoveryProvider(),
    private readonly publicSearch = new PublicRecruiterSearchProvider(),
    private readonly identitySearch = new PublicRecruiterIdentitySearchProvider()
  ) {}

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const [identityResult, firstPartyResult, publicSearchResult] = await Promise.all([
      this.identitySearch.discover(input),
      this.firstParty.discover(input),
      this.publicSearch.discover(input)
    ]);

    const identityContacts: RecruiterIdentityCandidate[] = identityResult.map((contact) => ({
      ...contact,
      provider: this.name,
      companyDomain: input.companyDomain,
      sources: contact.sources ?? []
    }));
    return {
      provider: this.name,
      contacts: mergeContacts([
        ...identityContacts,
        ...firstPartyResult.contacts,
        ...publicSearchResult.contacts
      ]),
      discoveredAt: new Date()
    };
  }

  async discoverEmails(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const [firstPartyResult, publicSearchResult] = await Promise.all([
      this.firstParty.discover(input),
      this.publicSearch.discover(input)
    ]);
    return {
      provider: this.name,
      contacts: mergeContacts([
        ...firstPartyResult.contacts.filter(hasEmail),
        ...publicSearchResult.contacts.filter(hasEmail)
      ]),
      discoveredAt: new Date()
    };
  }

  verify(email: string): Promise<RecruiterVerificationResult> {
    return this.publicSearch.verify(email);
  }
}

export function createRecruiterDiscoveryProvider(_config: RecruiterDiscoveryProviderConfig): RecruiterDiscoveryProvider {
  return new LayeredPublicRecruiterDiscoveryProvider();
}
