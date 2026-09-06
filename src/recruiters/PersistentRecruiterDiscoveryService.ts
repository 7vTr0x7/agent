import {
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterContactCandidate
} from "./RecruiterDiscovery";
import { rankRecruiterContacts, RankedRecruiterContact } from "./RecruiterRanking";
import {
  RecruiterDiscoveryRepository,
  StoredRecruiterContact
} from "./RecruiterDiscoveryRepository";

export interface PersistentRecruiterDiscoveryOptions {
  provider: RecruiterDiscoveryProvider;
  repository: RecruiterDiscoveryRepository;
  cooldownHours?: number;
}

export interface PersistentRecruiterDiscoveryResult {
  status: "DISCOVERED" | "SKIPPED";
  reason: string;
  runId: string | null;
  contacts: Array<StoredRecruiterContact & Pick<RankedRecruiterContact, "score" | "reasons">>;
}

export class PersistentRecruiterDiscoveryService {
  private readonly cooldownHours: number;

  constructor(private readonly options: PersistentRecruiterDiscoveryOptions) {
    this.cooldownHours = options.cooldownHours ?? 24;
    if (!Number.isFinite(this.cooldownHours) || this.cooldownHours < 0) {
      throw new Error("Recruiter discovery cooldown must be a non-negative finite number.");
    }
  }

  async discoverAndPersist(
    input: RecruiterDiscoveryInput,
    maxContacts: number
  ): Promise<PersistentRecruiterDiscoveryResult> {
    if (!input.candidateProfileId.trim()) {
      throw new Error("candidateProfileId is required for recruiter discovery.");
    }
    if (!Number.isInteger(maxContacts) || maxContacts < 1) {
      throw new Error("maxContacts must be a positive integer.");
    }

    const domain = input.companyDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
    if (!domain) throw new Error("A company domain is required for recruiter discovery.");

    if (await this.options.repository.hasRecentDiscovery(domain, this.options.provider.name, this.cooldownHours)) {
      return {
        status: "SKIPPED",
        reason: `A successful ${this.options.provider.name} discovery exists within the ${this.cooldownHours}-hour cooldown.`,
        runId: null,
        contacts: []
      };
    }

    const run = await this.options.repository.startDiscoveryRun({
      companyName: input.companyName,
      companyDomain: domain,
      jobOpportunityId: input.jobOpportunityId,
      candidateProfileId: input.candidateProfileId,
      provider: this.options.provider.name
    });

    try {
      const discovered = await this.options.provider.discover(input);
      const ranked = rankRecruiterContacts(discovered.contacts, input.jobTitle, maxContacts);
      const persisted: Array<StoredRecruiterContact & Pick<RankedRecruiterContact, "score" | "reasons">> = [];

      for (const candidate of ranked) {
        const contact = await this.options.repository.upsertContact(
          input.companyName,
          domain,
          candidate
        );
        await this.options.repository.addSources(contact.id, candidate);
        persisted.push({ ...contact, score: candidate.score, reasons: candidate.reasons });
      }

      await this.options.repository.finishDiscoveryRun(run.id, "SUCCEEDED", discovered.contacts.length);
      return {
        status: "DISCOVERED",
        reason: `Persisted ${persisted.length} ranked recruiter contact(s) from ${discovered.contacts.length} discovered contact(s).`,
        runId: run.id,
        contacts: persisted
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.repository.finishDiscoveryRun(run.id, "FAILED", 0, message);
      throw error;
    }
  }
}

export function deduplicateRecruiterCandidates(
  contacts: RecruiterContactCandidate[]
): RecruiterContactCandidate[] {
  const byEmail = new Map<string, RecruiterContactCandidate>();
  for (const contact of contacts) {
    const email = contact.email.trim().toLowerCase();
    const existing = byEmail.get(email);
    if (!existing || (contact.confidence ?? -1) > (existing.confidence ?? -1) || contact.verified) {
      byEmail.set(email, { ...contact, email });
    }
  }
  return [...byEmail.values()];
}
