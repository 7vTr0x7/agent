import { ApplicationTaskHandler } from "./ApplicationTaskHandler";
import { CandidateProfile } from "../candidates/CandidateProfile";

const profile: CandidateProfile = {
  id: "candidate-1",
  yearsExperience: 3,
  skills: ["React.js", "TypeScript"],
  targetTitles: ["Frontend Engineer"],
  fullName: "Salman Shaikh",
  email: "candidate@example.com"
};

describe("ApplicationTaskHandler recruiter discovery integration", () => {
  const prepared = {
    prepared: true as const,
    application: {
      applicationId: "application-1",
      jobOpportunityId: "job-1",
      candidateProfileId: "candidate-1",
      url: "https://jobs.example.com/frontend-engineer",
      jobTitle: "Frontend Engineer",
      companyName: "Acme Co",
      companyDomain: "acme.dev",
      jobDescription: "Build React and TypeScript applications."
    }
  };

  const outcome = {
    submitted: false,
    safetyAllowed: true,
    reason: "Dry run completed.",
    adapterName: "generic",
    result: null
  };

  function createHandler(recruiterDiscoveryDispatcher: { enqueue: jest.Mock }) {
    return new ApplicationTaskHandler(
      { prepare: jest.fn().mockResolvedValue(prepared) },
      { submit: jest.fn().mockResolvedValue(outcome) },
      { getById: jest.fn().mockResolvedValue(profile) },
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      recruiterDiscoveryDispatcher as never
    );
  }

  it("queues recruiter discovery with the truthful failed application outcome when the application is not submitted", async () => {
    const dispatcher = { enqueue: jest.fn().mockResolvedValue("discovery-task-1") };
    const handler = createHandler(dispatcher);

    await handler.handle({
      id: "task-1",
      taskType: "APPLY_JOB",
      payload: { jobOpportunityId: "job-1", candidateProfileId: "candidate-1" }
    } as never);

    expect(dispatcher.enqueue).toHaveBeenCalledWith({
      companyName: "Acme Co",
      companyDomain: "acme.dev",
      jobTitle: "Frontend Engineer",
      jobDescription: "Build React and TypeScript applications.",
      candidateProfileId: "candidate-1",
      candidateName: "Salman Shaikh",
      jobOpportunityId: "job-1",
      applicationId: "application-1",
      applicationOutcome: "FAILED"
    });
  });

  it("does not queue recruiter discovery for permanently excluded companies", async () => {
    const dispatcher = { enqueue: jest.fn() };
    const excludedPrepared = {
      ...prepared,
      application: { ...prepared.application, companyName: "Octopus Technologies" }
    };
    const handler = new ApplicationTaskHandler(
      { prepare: jest.fn().mockResolvedValue(excludedPrepared) },
      { submit: jest.fn().mockResolvedValue(outcome) },
      { getById: jest.fn().mockResolvedValue(profile) },
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      dispatcher as never
    );

    await handler.handle({
      id: "task-2",
      taskType: "APPLY_JOB",
      payload: { jobOpportunityId: "job-2", candidateProfileId: "candidate-1" }
    } as never);

    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });
});
