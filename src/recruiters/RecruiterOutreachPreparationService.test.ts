import { RecruiterOutreachPreparationService } from "./RecruiterOutreachPreparationService";
import { StoredRecruiterContact } from "./RecruiterDiscoveryRepository";

function contact(overrides: Partial<StoredRecruiterContact> = {}): StoredRecruiterContact {
  return {
    id: "contact-1",
    companyName: "Example Co",
    companyDomain: "example.com",
    email: "recruiter@example.com",
    fullName: "Alex Recruiter",
    title: "Technical Recruiter",
    department: "Talent Acquisition",
    seniority: "Senior",
    confidence: 95,
    verified: true,
    verificationStatus: "valid",
    provider: "hunter",
    ...overrides
  };
}

function repository(options: {
  suppressed?: { email: boolean; domain: boolean };
  duplicate?: boolean;
} = {}) {
  const calls = { sequences: 0, messages: 0 };
  const repo = {
    isSuppressed: jest.fn().mockResolvedValue(options.suppressed ?? { email: false, domain: false }),
    isOutreachSequenceDuplicate: jest.fn().mockResolvedValue(options.duplicate ?? false),
    createOutreachSequence: jest.fn().mockImplementation(async (input) => {
      calls.sequences += 1;
      return {
        id: "sequence-1",
        recruiterContactId: input.recruiterContactId,
        jobOpportunityId: input.jobOpportunityId,
        applicationId: input.applicationId,
        candidateProfileId: input.candidateProfileId,
        status: "READY",
        nextActionAt: null
      };
    }),
    createOutreachMessage: jest.fn().mockImplementation(async (input) => {
      calls.messages += 1;
      return {
        id: "message-1",
        sequenceId: input.sequenceId,
        messageType: input.messageType,
        sequenceStep: input.sequenceStep,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
        body: input.body,
        status: "PREPARED"
      };
    })
  };
  return { repo, calls };
}

describe("RecruiterOutreachPreparationService", () => {
  const input = {
    companyName: "Example Co",
    companyDomain: "example.com",
    jobTitle: "Frontend Engineer",
    jobDescription: "Build React applications.",
    jobOpportunityId: "job-1",
    applicationId: "application-1",
    candidateProfileId: "candidate-1",
    candidateName: "Salman Shaikh"
  };

  it("prepares a deterministic initial message but does not send it", async () => {
    const { repo, calls } = repository();
    const service = new RecruiterOutreachPreparationService({ repository: repo as never, dryRun: true });

    const result = await service.prepare(input, [contact()]);

    expect(result).toHaveLength(1);
    expect(calls.sequences).toBe(1);
    expect(calls.messages).toBe(1);
    expect(result[0].message.status).toBe("PREPARED");
    expect(result[0].message.subject).toBe("Application for Frontend Engineer at Example Co");
    expect(result[0].message.body).toContain("I’m Salman Shaikh");
    expect(result[0].message.body).toContain("I’ve applied for the role");
  });

  it("blocks suppressed contacts before creating a sequence", async () => {
    const { repo, calls } = repository({ suppressed: { email: true, domain: false } });
    const service = new RecruiterOutreachPreparationService({ repository: repo as never });

    await expect(service.prepare(input, [contact()])).resolves.toEqual([]);
    expect(calls.sequences).toBe(0);
    expect(calls.messages).toBe(0);
  });

  it("blocks contacts already used by an outreach sequence", async () => {
    const { repo, calls } = repository({ duplicate: true });
    const service = new RecruiterOutreachPreparationService({ repository: repo as never });

    await expect(service.prepare(input, [contact()])).resolves.toEqual([]);
    expect(calls.sequences).toBe(0);
    expect(calls.messages).toBe(0);
  });

  it("blocks an unverified contact when verification is required", async () => {
    const { repo, calls } = repository();
    const service = new RecruiterOutreachPreparationService({ repository: repo as never, requireVerifiedEmail: true });

    await expect(service.prepare(input, [contact({ verified: false })])).resolves.toEqual([]);
    expect(calls.sequences).toBe(0);
  });

  it("blocks a contact below the configured confidence threshold", async () => {
    const { repo, calls } = repository();
    const service = new RecruiterOutreachPreparationService({ repository: repo as never, minConfidence: 90 });

    await expect(service.prepare(input, [contact({ confidence: 89 })])).resolves.toEqual([]);
    expect(calls.sequences).toBe(0);
  });

  it("never prepares an off-domain email", async () => {
    const { repo, calls } = repository();
    const service = new RecruiterOutreachPreparationService({ repository: repo as never });

    await expect(service.prepare(input, [contact({ email: "recruiter@other.example" })])).resolves.toEqual([]);
    expect(calls.sequences).toBe(0);
  });
});
