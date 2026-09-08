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

describe("ApplicationTaskHandler recruiter independence", () => {
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

  it("does not enqueue recruiter discovery from the application task", async () => {
    const dispatcher = { enqueue: jest.fn() };
    const handler = new ApplicationTaskHandler(
      { prepare: jest.fn().mockResolvedValue(prepared) },
      { submit: jest.fn().mockResolvedValue(outcome) },
      { getById: jest.fn().mockResolvedValue(profile) },
      [], undefined, undefined, undefined, undefined, dispatcher
    );

    await handler.handle({
      id: "task-1",
      taskType: "APPLY_JOB",
      payload: { jobOpportunityId: "job-1", candidateProfileId: "candidate-1" }
    } as never);

    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });
});
