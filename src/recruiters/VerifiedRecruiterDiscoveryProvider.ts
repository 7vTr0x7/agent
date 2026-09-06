import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

export interface RecruiterContactVerifier {
  verify(email: string): Promise<RecruiterVerificationResult>;
}

export class VerifiedRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name: string;

  constructor(
    private readonly discoveryProvider: RecruiterDiscoveryProvider,
    private readonly verifier: RecruiterContactVerifier
  ) {
    this.name = `${discoveryProvider.name}-verified`;
  }

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const discovered = await this.discoveryProvider.discover(input);
    const contacts: RecruiterContactCandidate[] = [];

    for (const contact of discovered.contacts) {
      if (contact.verified) {
        contacts.push(contact);
        continue;
      }

      const verification = await this.verifier.verify(contact.email);
      contacts.push({
        ...contact,
        verified: verification.verified,
        verificationStatus: verification.status,
        confidence: verification.confidence ?? contact.confidence,
        provider: contact.provider,
        sources: contact.sources
      });
    }

    return {
      provider: this.name,
      contacts,
      discoveredAt: discovered.discoveredAt
    };
  }

  verify(email: string): Promise<RecruiterVerificationResult> {
    return this.verifier.verify(email);
  }
}
