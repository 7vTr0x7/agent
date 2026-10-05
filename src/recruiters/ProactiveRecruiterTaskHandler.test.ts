import { ProactiveRecruiterTaskHandler } from "./ProactiveRecruiterTaskHandler";
import { PROACTIVE_RECRUITER_DISCOVERY_TASK } from "./ProactiveRecruiterTask";

describe("ProactiveRecruiterTaskHandler", () => {
  it("discovers recruiters without a job and allows a usable unverified email to be prepared", async () => {
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
      listPublicContactFirstCandidates: jest.fn().mockResolvedValue([]),
      persistCandidate: jest.fn().mockResolvedValue("contact-1"),
      createProactiveCampaign: jest.fn().mockResolvedValue({ sequenceId: "sequence-1", messageId: "message-1" })
    };
    const sendDispatcher = { enqueue: jest.fn() };
    const logger = { info: jest.fn(), error: jest.fn() };
    const handler = new ProactiveRecruiterTaskHandler(
      discovery as never,
      repository as never,
      sendDispatcher as never,
      { enabled: true, sendEnabled: true, maxCandidatesPerRun: 10 },
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
    expect(repository.createProactiveCampaign).toHaveBeenCalledTimes(1);
    expect(sendDispatcher.enqueue).toHaveBeenCalledWith({ messageId: expect.any(String), companyDomain: "acme.example" });
  });

  it("uses a current contact without requiring mailbox-level verification evidence", async () => {
    const discovery = { discover: jest.fn().mockResolvedValue([{
      recruiterName: "Jane Doe", recruiterRole: "Technical Recruiter", employer: "Acme", employerDomain: "acme.example",
      targetRoles: ["frontend engineer"], roleMatchScore: 90, hiringEvidenceScore: 90, overallConfidence: 95,
      discoverySource: "public-web", discoveryUrl: "https://linkedin.com/in/jane-doe", discoveryEvidence: ["Technical recruiter"],
      evidenceType: "public_profile", evidenceDate: new Date().toISOString(), evidenceFreshness: "current",
      email: "jane@acme.example", emailStatus: "VERIFIED"
    }]) };
    const repository = {
      listPublicContactFirstCandidates: jest.fn().mockResolvedValue([]),
      persistCandidate: jest.fn().mockResolvedValue("contact-1"),
      createProactiveCampaign: jest.fn().mockResolvedValue({ sequenceId: "sequence-1", messageId: "message-1" })
    };
    const sendDispatcher = { enqueue: jest.fn().mockResolvedValue("task-1") };
    const handler = new ProactiveRecruiterTaskHandler(discovery as never, repository as never, sendDispatcher as never,
      {
        enabled: true,
        sendEnabled: true,
        maxCandidatesPerRun: 10
        verifyEmail: async () => ({
          status: "mailbox_verified",
          confidence: 100,
          verificationEvidence: [{ provider: "snov", status: "valid", mailboxLevel: true, source: "snov" }]
        })
      }, { info: jest.fn(), error: jest.fn() });

    await handler.handleDiscovery({ candidateProfileId: "candidate-1", yearsExperience: 3, skills: ["React", "Next.js"], targetRoles: ["Frontend Engineer"], maxCandidates: 10 });

    expect(repository.createProactiveCampaign).toHaveBeenCalledWith(expect.objectContaining({ candidateProfileId: "candidate-1", targetRoles: ["Frontend Engineer"] }));
    expect(sendDispatcher.enqueue).toHaveBeenCalledWith({ messageId: "message-1", companyDomain: "acme.example" });
  });
  it("uses public contact resources before web discovery and does not require hiring evidence", async () => {
    const discovery = { discover: jest.fn() };
    const repository = {
      listPublicContactFirstCandidates: jest.fn().mockResolvedValue([{
        recruiterContactId: "contact-public-1",
        companyName: "Acme",
        companyDomain: "acme.example",
        email: "recruiter@acme.example",
        sourceUrl: null,
        fullName: "Jane Doe"
      }]),
      persistCandidate: jest.fn(),
      createProactiveCampaign: jest.fn().mockResolvedValue({ sequenceId: "sequence-public-1", messageId: "message-public-1" })
    };
    const sendDispatcher = { enqueue: jest.fn().mockResolvedValue("task-public-1") };
    const handler = new ProactiveRecruiterTaskHandler(
      discovery as never,
      repository as never,
      sendDispatcher as never,
      { enabled: true, sendEnabled: true, maxCandidatesPerRun: 10 },
      { info: jest.fn(), error: jest.fn() }
    );

    await handler.handleDiscovery({
      candidateProfileId: "candidate-1",
      candidateName: "Candidate",
      yearsExperience: 3,
      skills: ["React", "Next.js"],
      targetRoles: ["Frontend Engineer"],
      maxCandidates: 10
    });

    expect(repository.listPublicContactFirstCandidates).toHaveBeenCalledWith(10);
    expect(discovery.discover).not.toHaveBeenCalled();
    expect(repository.createProactiveCampaign).toHaveBeenCalledWith(expect.objectContaining({
      recruiterContactId: "contact-public-1",
      candidateProfileId: "candidate-1",
      reusePrepared: true,
      subject: "Full-Stack Developer — React, Next.js & Node.js — Candidate",
      body: expect.stringContaining("I’m currently exploring Full-Stack Developer opportunities where I can contribute across frontend development and backend/API work.")
    }));
    expect(repository.createProactiveCampaign).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("I wanted to introduce myself and share my resume in case my background is relevant to any current or upcoming opportunities.")
    }));
    expect(repository.createProactiveCampaign).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("I’ve attached my resume for reference")
    }));
    expect(repository.createProactiveCampaign).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("Hi Jane,")
    }));
    expect(sendDispatcher.enqueue).toHaveBeenCalledWith({
      messageId: "message-public-1",
      companyDomain: "acme.example"
    });
  });

});


describe("recruiter greeting fallback", () => {
  it("uses Hiring Team when the public recruiter contact has no name", async () => {
    const discovery = { discover: jest.fn() };
    const repository = {
      listPublicContactFirstCandidates: jest.fn().mockResolvedValue([{
        recruiterContactId: "contact-public-2",
        companyName: "Acme",
        companyDomain: "acme.example",
        email: "hiring@acme.example",
        sourceUrl: "https://example.com/public-contact",
        fullName: null
      }]),
      persistCandidate: jest.fn(),
      createProactiveCampaign: jest.fn().mockResolvedValue({ sequenceId: "sequence-public-2", messageId: "message-public-2" })
    };
    const sendDispatcher = { enqueue: jest.fn() };
    const handler = new ProactiveRecruiterTaskHandler(
      discovery as never,
      repository as never,
      sendDispatcher as never,
      { enabled: true, sendEnabled: false, maxCandidatesPerRun: 10 },
      { info: jest.fn(), error: jest.fn() }
    );

    await handler.handleDiscovery({
      candidateProfileId: "candidate-1",
      candidateName: "Salman Shaikh",
      yearsExperience: 3,
      skills: ["React", "Next.js"],
      targetRoles: ["Frontend Engineer"],
      maxCandidates: 10
    });

    expect(repository.createProactiveCampaign).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("Hi Hiring Team,")
    }));
  });
});
