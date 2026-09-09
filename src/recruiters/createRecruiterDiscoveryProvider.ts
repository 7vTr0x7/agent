import { JobPostingRecruiterDiscoveryProvider } from "./JobPostingRecruiterDiscoveryProvider";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
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

/**
 * Free-first layered recruiter discovery.
 *
 * First-party job-posting/company-page discovery is always consulted so
 * explicit recruiting contacts are not lost. Public search evidence is then
 * merged as a secondary signal. The merged provider keeps the public-web
 * identity and uses MX verification for outbound-eligible contacts.
 */
class LayeredPublicRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "public-web";

  constructor(
    private readonly firstParty = new JobPostingRecruiterDiscoveryProvider(),
    private readonly publicSearch = new PublicRecruiterSearchProvider()
  ) {}

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const [firstPartyResult, publicSearchResult] = await Promise.all([
      this.firstParty.discover(input),
      this.publicSearch.discover(input)
    ]);

    const byEmail = new Map<string, RecruiterContactCandidate>();
    for (const contact of [...firstPartyResult.contacts, ...publicSearchResult.contacts]) {
      const email = contact.email.trim().toLowerCase();
      if (!email) continue;
      const normalized: RecruiterContactCandidate = {
        ...contact,
        email,
        provider: this.name,
        sources: contact.sources ?? []
      };
      const existing = byEmail.get(email);
      if (!existing) {
        byEmail.set(email, normalized);
        continue;
      }

      byEmail.set(email, {
        ...existing,
        fullName: existing.fullName ?? normalized.fullName,
        title: existing.title ?? normalized.title,
        department: existing.department ?? normalized.department,
        seniority: existing.seniority ?? normalized.seniority,
        location: existing.location ?? normalized.location,
        country: existing.country ?? normalized.country,
        confidence: Math.max(existing.confidence ?? 0, normalized.confidence ?? 0),
        verified: existing.verified || normalized.verified,
        verificationStatus: existing.verified
          ? existing.verificationStatus
          : normalized.verified
            ? normalized.verificationStatus
            : existing.verificationStatus ?? normalized.verificationStatus,
        linkedinProfileUrl: existing.linkedinProfileUrl ?? normalized.linkedinProfileUrl,
        sources: [...existing.sources, ...normalized.sources]
      });
    }

    return {
      provider: this.name,
      contacts: [...byEmail.values()],
      discoveredAt: new Date(Math.max(firstPartyResult.discoveredAt.getTime(), publicSearchResult.discoveredAt.getTime()))
    };
  }

  verify(email: string): Promise<RecruiterVerificationResult> {
    return this.publicSearch.verify(email);
  }
}

export function createRecruiterDiscoveryProvider(_config: RecruiterDiscoveryProviderConfig): RecruiterDiscoveryProvider {
  return new LayeredPublicRecruiterDiscoveryProvider();
}
