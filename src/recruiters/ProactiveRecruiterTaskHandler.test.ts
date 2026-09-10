import { ProactiveRecruiterTaskHandler } from "./ProactiveRecruiterTaskHandler";
import { PROACTIVE_RECRUITER_DISCOVERY_TASK } from "./ProactiveRecruiterTask";

describe("ProactiveRecruiterTaskHandler", () => {
  it("discovers recruiters without a job and keeps unverified public email from being sent", async () => {
    const discovery = {
      discover: jest.fn().mockResolvedValue([{
        recruiterName: "Jane Doe",
        recruiterRole: "Technical Recruiter",
        employer: "Acme",
        employerDomain: "acme.example",
        targetRoles: ["frontend engineer", "react"],
        roleMatchScore: 80,
        hiringEvidenceScore: 70,
        overallConfidence: 85,
        discoverySource: "public-web",
        discoveryUrl: "https://linkedin.com/in/jane-doe",
        discoveryEvidence: ["Technical recruiter hiring React frontend engineers"],
        evidenceType: "job_hiring_evidence",
        evidenceDate: new Date().toISOString(),
        evidenceFreshness: "current",
        email: "jane@acme.example",
        emailStatus: "UNVERIFIED"
      }])
    };
    const repository = {
      persistCandidate: jest.fn().mockResolvedValue("contact-1"),
      createProactiveCampaign: jest.fn().mockResolvedValue(null)
    };
    const sendDispatcher = { enqueue: jest.fn() };
    const logger = { info: jest.fn(), error: jest.fn() };
    const handler = new ProactiveRecruiterTaskHandler(
      discovery as never,
      repository as never,
      sendDispatcher as never,
      { enabled: true, sendEnabled: true, maxCandidatesPerRun: 10, requireVerifiedEmail: true, verifyEmail: async () => ({ status: "UNVERIFIED", confidence: 0 }) },
      logger
    );

    await handler.handle({
      id: "task-1",
      taskType: PROACTIVE_RECRUITER_DISCOVERY_TASK,
      payload: {
        candidateProfileId: "candidate-1",
        candidateName: "Candidate",
        yearsExperience: 3,
        skills: ["React", "TypeScript"],
        targetRoles: ["Frontend Engineer", "React Developer"],
        location: "Pune",
        maxCandidates: 10
      },
      status: "RUNNING",
      priority: 1,
      availableAt: new Date(),
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lockedBy: "worker-1",
      attempts: 1,
      maxAttempts: 3,
      dedupeKey: "proactive:candidate-1",
      workerId: "worker-1"
    });

    expect(discovery.discover).toHaveBeenCalledWith(expect.objectContaining({ targetRoles: ["Frontend Engineer", "React Developer"] }));
    expect(repository.persistCandidate).toHaveBeenCalledTimes(1);
    expect(repository.createProactiveCampaign).not.toHaveBeenCalled();
    expect(sendDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it("uses a current verified public contact for proactive outreach without a job", async () => {
    const discovery = { discover: jest.fn().mockResolvedValue([{
      recruiterName: "Jane Doe", recruiterRole: "Technical Recruiter", employer: "Acme", employerDomain: "acme.example",
      targetRoles: ["frontend engineer"], roleMatchScore: 90, hiringEvidenceScore: 90, overallConfidence: 95,
      discoverySource: "public-web", discoveryUrl: "https://linkedin.com/in/jane-doe", discoveryEvidence: ["Technical recruiter"],
      evidenceType: "public_profile", evidenceDate: new Date().toISOString(), evidenceFreshness: "current",
      email: "jane@acme.example", emailStatus: "VERIFIED"
    }]) };
    const repository = {
      persistCandidate: jest.fn().mockResolvedValue("contact-1"),
      createProactiveCampaign: jest.fn().mockResolvedValue({ sequenceId: "sequence-1", messageId: "message-1" })
    };
    const sendDispatcher = { enqueue: jest.fn().mockResolvedValue("task-1") };
    const handler = new ProactiveRecruiterTaskHandler(discovery as never, repository as never, sendDispatcher as never,
      { enabled: true, sendEnabled: true, maxCandidatesPerRun: 10, requireVerifiedEmail: true, verifyEmail: async () => ({ status: "VERIFIED", confidence: 100 }) }, { info: jest.fn(), error: jest.fn() });

    await handler.handleDiscovery({ candidateProfileId: "candidate-1", yearsExperience: 3, skills: ["React", "Next.js"], targetRoles: ["Frontend Engineer"], maxCandidates: 10 });

    expect(repository.createProactiveCampaign).toHaveBeenCalledWith(expect.objectContaining({ candidateProfileId: "candidate-1", targetRoles: ["Frontend Engineer"] }));
    expect(sendDispatcher.enqueue).toHaveBeenCalledWith({ messageId: "message-1", companyDomain: "acme.example" });
  });
});
