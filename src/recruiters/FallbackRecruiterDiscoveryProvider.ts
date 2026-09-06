import { RecruiterContactCandidate, RecruiterDiscoveryInput, RecruiterDiscoveryProvider, RecruiterDiscoveryResult, RecruiterVerificationResult } from "./RecruiterDiscovery";

export class FallbackRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name: string;

  constructor(
    private readonly primary: RecruiterDiscoveryProvider,
    private readonly fallback: RecruiterDiscoveryProvider,
    private readonly fallbackVerifier?: RecruiterDiscoveryProvider
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    let primaryResult: RecruiterDiscoveryResult | null = null;
    try {
      primaryResult = await this.primary.discover(input);
      const verifiedPrimary = primaryResult.contacts.filter((contact) => contact.verified);
      if (verifiedPrimary.length > 0) {
        return { ...primaryResult, contacts: verifiedPrimary };
      }
    } catch {
      // The fallback is intentionally allowed to continue when the primary provider is unavailable.
    }

    const fallbackResult = await this.fallback.discover(input);
    if (!this.fallbackVerifier) return fallbackResult;

    const verified: RecruiterContactCandidate[] = [];
    for (const contact of fallbackResult.contacts) {
      if (contact.verified) {
        verified.push(contact);
        continue;
      }
      const result = await this.fallbackVerifier.verify(contact.email);
      if (!result.verified) continue;
      verified.push({
        ...contact,
        verified: true,
        verificationStatus: result.status,
        confidence: result.confidence ?? contact.confidence,
        provider: `${contact.provider}-verified`
      });
    }

    return { provider: this.name, contacts: verified, discoveredAt: new Date() };
  }

  async verify(email: string): Promise<RecruiterVerificationResult> {
    return this.primary.verify(email);
  }
}
