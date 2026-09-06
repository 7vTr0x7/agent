import { RecruiterContactCandidate } from "./RecruiterDiscovery";
import {
  RecruiterDiscoveryRepository,
  StoredRecruiterContact,
  RecruiterOutreachSequenceRecord,
  RecruiterOutreachMessageRecord
} from "./RecruiterDiscoveryRepository";
import { evaluateRecruiterOutreachSafety } from "./RecruiterOutreachSafetyGate";

export interface RecruiterOutreachPreparationInput {
  companyName: string;
  companyDomain: string;
  jobTitle: string;
  jobDescription: string;
  jobOpportunityId: string;
  applicationId: string;
  candidateProfileId: string;
  candidateName: string;
}

export interface PreparedRecruiterOutreach {
  contact: StoredRecruiterContact;
  sequence: RecruiterOutreachSequenceRecord;
  message: RecruiterOutreachMessageRecord;
}

export interface RecruiterOutreachPreparationOptions {
  repository: RecruiterDiscoveryRepository;
  minConfidence?: number;
  requireVerifiedEmail?: boolean;
  dryRun?: boolean;
}

export class RecruiterOutreachPreparationService {
  private readonly minConfidence: number;
  private readonly requireVerifiedEmail: boolean;
  private readonly dryRun: boolean;

  constructor(private readonly options: RecruiterOutreachPreparationOptions) {
    this.minConfidence = options.minConfidence ?? 80;
    this.requireVerifiedEmail = options.requireVerifiedEmail ?? true;
    this.dryRun = options.dryRun ?? true;
  }

  async prepare(
    input: RecruiterOutreachPreparationInput,
    contacts: StoredRecruiterContact[]
  ): Promise<PreparedRecruiterOutreach[]> {
    if (!input.jobOpportunityId.trim()) throw new Error("jobOpportunityId is required for recruiter outreach.");
    if (!input.applicationId.trim()) throw new Error("applicationId is required for recruiter outreach.");
    if (!input.candidateProfileId.trim()) throw new Error("candidateProfileId is required for recruiter outreach.");

    const prepared: PreparedRecruiterOutreach[] = [];

    for (const contact of contacts) {
      const suppressed = await this.options.repository.isSuppressed(contact.email, input.companyDomain);
      const duplicate = await this.options.repository.isOutreachSequenceDuplicate(
        contact.id,
        input.jobOpportunityId,
        input.candidateProfileId
      );

      const candidate: RecruiterContactCandidate = {
        email: contact.email,
        fullName: contact.fullName,
        title: contact.title,
        department: contact.department,
        seniority: contact.seniority,
        country: contact.country,
        location: contact.location,
        confidence: contact.confidence,
        verified: contact.verified,
        verificationStatus: contact.verificationStatus,
        provider: contact.provider,
        sources: []
      };

      const safety = evaluateRecruiterOutreachSafety({
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        contact: candidate,
        minConfidence: this.minConfidence,
        requireVerifiedEmail: this.requireVerifiedEmail,
        suppressedEmail: suppressed.email,
        suppressedDomain: suppressed.domain,
        duplicateSequence: duplicate,
        dryRun: this.dryRun
      });

      if (!safety.allowed) continue;

      const sequence = await this.options.repository.createOutreachSequence({
        recruiterContactId: contact.id,
        jobOpportunityId: input.jobOpportunityId,
        applicationId: input.applicationId,
        candidateProfileId: input.candidateProfileId
      });
      if (!sequence) continue;

      const message = await this.options.repository.createOutreachMessage({
        sequenceId: sequence.id,
        messageType: "INITIAL",
        sequenceStep: 0,
        recipientEmail: contact.email,
        subject: `Application for ${input.jobTitle} at ${input.companyName}`,
        body: buildInitialMessage(input, contact)
      });

      prepared.push({ contact, sequence, message });
    }

    return prepared;
  }
}

function buildInitialMessage(
  input: RecruiterOutreachPreparationInput,
  contact: StoredRecruiterContact
): string {
  const greeting = contact.fullName ? `Hi ${contact.fullName.split(" ")[0]},` : "Hi,";
  const role = input.jobTitle.trim();
  const company = input.companyName.trim();
  const candidate = input.candidateName.trim() || "Candidate";

  return [
    greeting,
    "",
    `I’m ${candidate}, and I’m interested in the ${role} opportunity at ${company}.`,
    "",
    "I’ve applied for the role and wanted to reach out directly in case you’re involved in the hiring process. I’d be happy to share any additional information that would be useful for the team.",
    "",
    "Thank you for your time.",
    "",
    candidate
  ].join("\n");
}
