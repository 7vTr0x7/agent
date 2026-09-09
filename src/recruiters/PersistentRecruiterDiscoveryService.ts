import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { RecruiterDiscoveryInput, RecruiterDiscoveryProvider, RecruiterContactCandidate } from "./RecruiterDiscovery";
import { rankRecruiterContacts, RankedRecruiterContact } from "./RecruiterRanking";
import { RecruiterDiscoveryRepository, StoredRecruiterContact } from "./RecruiterDiscoveryRepository";

export interface PersistentRecruiterDiscoveryOptions {
  provider: RecruiterDiscoveryProvider;
  repository: RecruiterDiscoveryRepository;
  cooldownHours?: number;
  minConfidence?: number;
  requireVerifiedEmail?: boolean;
}

export interface PersistentRecruiterDiscoveryResult {
  status: "DISCOVERED" | "SKIPPED";
  reason: string;
  runId: string | null;
  contacts: Array<StoredRecruiterContact & Pick<RankedRecruiterContact, "score" | "reasons">>;
}

export class PersistentRecruiterDiscoveryService {
  private readonly cooldownHours: number;
  private readonly minConfidence: number;
  private readonly requireVerifiedEmail: boolean;

  constructor(private readonly options: PersistentRecruiterDiscoveryOptions) {
    this.cooldownHours = options.cooldownHours ?? 0;
    this.minConfidence = options.minConfidence ?? 80;
    this.requireVerifiedEmail = options.requireVerifiedEmail ?? true;
    if (!Number.isFinite(this.cooldownHours) || this.cooldownHours < 0) throw new Error("Recruiter discovery cooldown must be a non-negative finite number.");
    if (!Number.isFinite(this.minConfidence) || this.minConfidence < 0 || this.minConfidence > 100) throw new Error("Recruiter discovery minimum confidence must be between 0 and 100.");
  }

  async discoverAndPersist(input: RecruiterDiscoveryInput, maxContacts: number): Promise<PersistentRecruiterDiscoveryResult> {
    if (!input.candidateProfileId.trim()) throw new Error("candidateProfileId is required for recruiter discovery.");
    if (!Number.isInteger(maxContacts) || maxContacts < 1) throw new Error("maxContacts must be a positive integer.");
    const domain = input.companyDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
    if (!domain) throw new Error("A company domain is required for recruiter discovery.");

    if (isPermanentlyExcludedCompany(input.companyName)) {
      return { status: "SKIPPED", reason: "Company is permanently excluded from recruiter discovery and outreach.", runId: null, contacts: [] };
    }

    if (this.cooldownHours > 0 && await this.options.repository.hasRecentDiscovery(domain, this.options.provider.name, this.cooldownHours)) {
      return { status: "SKIPPED", reason: `A successful ${this.options.provider.name} discovery exists within the ${this.cooldownHours}-hour cooldown.`, runId: null, contacts: [] };
    }

    const run = await this.options.repository.startDiscoveryRun({ companyName: input.companyName, companyDomain: domain, jobOpportunityId: input.jobOpportunityId, candidateProfileId: input.candidateProfileId, provider: this.options.provider.name });
    try {
      const discovered = await this.options.provider.discover(input);
      const candidates = await this.verifyDiscoveredContacts(discovered.contacts);
      const eligible = candidates.filter((contact) => {
        if (this.requireVerifiedEmail && !contact.verified) return false;
        return (contact.confidence ?? 0) >= this.minConfidence;
      });
      const uniqueCandidates = deduplicateRecruiterCandidates(eligible);
      const ranked = rankRecruiterContacts(uniqueCandidates, input.jobTitle, maxContacts);
      const persisted: Array<StoredRecruiterContact & Pick<RankedRecruiterContact, "score" | "reasons">> = [];
      for (const candidate of ranked) {
        const contact = await this.options.repository.upsertContact(input.companyName, domain, candidate);
        await this.options.repository.addSources(contact.id, candidate);
        persisted.push({ ...contact, score: candidate.score, reasons: candidate.reasons });
      }
      await this.options.repository.finishDiscoveryRun(run.id, "SUCCEEDED", uniqueCandidates.length);
      return { status: "DISCOVERED", reason: `Persisted ${persisted.length} verified recruiter contact(s) from ${uniqueCandidates.length} eligible contact(s).`, runId: run.id, contacts: persisted };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.repository.finishDiscoveryRun(run.id, "FAILED", 0, message);
      throw error;
    }
  }

  private async verifyDiscoveredContacts(contacts: RecruiterContactCandidate[]): Promise<RecruiterContactCandidate[]> {
    const results = await Promise.all(contacts.map(async (contact) => {
      if (contact.verified || !this.requireVerifiedEmail) return contact;
      try {
        const verification = await this.options.provider.verify(contact.email);
        if (!verification || !verification.verified) return contact;
        return {
          ...contact,
          verified: true,
          verificationStatus: verification.status,
          confidence: Math.min(100, Math.max(contact.confidence ?? 0, verification.confidence ?? 0))
        };
      } catch {
        return contact;
      }
    }));
    return results;
  }
}

function isPermanentlyExcludedCompany(companyName: string): boolean {
  const normalized = companyName.trim().toLowerCase();
  return PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.toLowerCase() === normalized);
}

export function deduplicateRecruiterCandidates(contacts: RecruiterContactCandidate[]): RecruiterContactCandidate[] {
  const byEmail = new Map<string, RecruiterContactCandidate>();
  for (const contact of contacts) {
    const email = contact.email.trim().toLowerCase();
    if (!email) continue;
    const normalized = { ...contact, email };
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, normalized);
      continue;
    }
    const existingConfidence = existing.confidence ?? -1;
    const candidateConfidence = normalized.confidence ?? -1;
    const shouldReplace = normalized.verified !== existing.verified ? normalized.verified : candidateConfidence > existingConfidence;
    if (shouldReplace) byEmail.set(email, normalized);
  }
  return [...byEmail.values()];
}
