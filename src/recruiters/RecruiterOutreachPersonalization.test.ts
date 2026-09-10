import { RecruiterOutreachPreparationService } from "./RecruiterOutreachPreparationService";
import { StoredRecruiterContact } from "./RecruiterDiscoveryRepository";

const contact: StoredRecruiterContact = {
  id: "contact-1",
  companyName: "Acme Co",
  companyDomain: "acme.dev",
  email: "alex@acme.dev",
  fullName: "Alex Recruiter",
  title: "Technical Recruiter",
  department: "Talent Acquisition",
  confidence: 95,
  verified: true,
  verificationStatus: "domain_mx_verified",
  provider: "public-web"
};

function repository() {
  return {
    isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }),
    isOutreachSequenceDuplicate: jest.fn().mockResolvedValue(false),
    createOutreachSequence: jest.fn().mockResolvedValue({ id: "sequence-1", recruiterContactId: contact.id, jobOpportunityId: "job-1", applicationId: null, candidateProfileId: "candidate-1", status: "READY", nextActionAt: null, followUpCount: 0 }),
    createOutreachMessage: jest.fn().mockImplementation(async (input) => ({ id: "message-1", sequenceId: input.sequenceId, messageType: input.messageType, sequenceStep: input.sequenceStep, recipientEmail: input.recipientEmail, subject: input.subject, body: input.body, status: "PREPARED" }))
  };
}

describe("Recruiter outreach personalization", () => {
  it("uses relevant candidate skills, experience, location, recruiter name, and truthful application state", async () => {
    const repo = repository();
    const service = new RecruiterOutreachPreparationService({ repository: repo as never, dryRun: true });
    const result = await service.prepare({
      companyName: "Acme Co",
      companyDomain: "acme.dev",
      jobTitle: "Frontend Engineer",
      jobDescription: "Build React and TypeScript applications with a modern frontend team.",
      jobOpportunityId: "job-1",
      candidateProfileId: "candidate-1",
      candidateName: "Salman Shaikh",
      candidateSkills: ["React", "Next.js", "TypeScript", "MongoDB"],
      candidateYearsExperience: 3,
      candidateLocation: "Pune, India",
      applicationOutcome: "NOT_ATTEMPTED"
    }, [contact]);

    const body = result[0]?.message.body ?? "";
    expect(body).toContain("Hi Alex,");
    expect(body).toContain("3 years of experience");
    expect(body).toContain("React, TypeScript");
    expect(body).toContain("Pune, India");
    expect(body).toContain("I’m reaching out directly regarding the opportunity");
    expect(body).not.toContain("I’ve applied for the role");
  });
});
