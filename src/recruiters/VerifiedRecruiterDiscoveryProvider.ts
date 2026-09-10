import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

export interface RecruiterContactVerifier { verify(email: string): Promise<RecruiterVerificationResult>; }

export class VerifiedRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name: string;
  constructor(private readonly discoveryProvider: RecruiterDiscoveryProvider, private readonly verifier: RecruiterContactVerifier) { this.name = `${discoveryProvider.name}-verified`; }

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const discovered = await this.discoveryProvider.discover(input);
    const contacts = discovered.contacts.map((contact) => {
      if (!contact.email || contact.verified) return contact;
      return this.verifyCandidate(contact);
    });
    return { provider: this.name, contacts: await Promise.all(contacts), discoveredAt: discovered.discoveredAt };
  }

  async discoverEmails(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const discovered = this.discoveryProvider.discoverEmails
      ? await this.discoveryProvider.discoverEmails(input)
      : await this.discoveryProvider.discover(input);
    const contacts: RecruiterContactCandidate[] = [];
    for (const contact of discovered.contacts) {
      if (!contact.email) continue;
      contacts.push(await this.verifyCandidate(contact));
    }
    return { provider: this.name, contacts, discoveredAt: discovered.discoveredAt };
  }

  verify(email: string): Promise<RecruiterVerificationResult> { return this.verifier.verify(email); }

  private async verifyCandidate(contact: RecruiterContactCandidate): Promise<RecruiterContactCandidate> {
    const verification = await this.verifier.verify(contact.email);
    return { ...contact, verified: verification.verified, verificationStatus: verification.status, confidence: Math.max(contact.confidence ?? 0, verification.confidence ?? 0), provider: contact.provider, sources: contact.sources };
  }
}
