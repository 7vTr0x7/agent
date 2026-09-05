import { ApplicationContext } from "./ApplicationAdapter";
import { ApplicationSubmissionOutcome } from "./ApplicationSubmissionService";
import { ApplicationTaskHandler } from "./ApplicationTaskHandler";
import { APPLY_JOB_TASK } from "./ApplicationTask";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { ClaimedTask } from "../queue/TaskQueue";

class FakeApplications {
  prepared = true;

  async prepare() {
    if (!this.prepared) {
      return { prepared: false as const, reason: "Application was blocked." };
    }

    return {
      prepared: true as const,
      application: {
        applicationId: "application-1",
        jobOpportunityId: "job-1",
        candidateProfileId: "candidate-1",
        url: "https://example.com/apply",
        companyName: "Example Corp"
      }
    };
  }
}

class FakeSubmissionService {
  requests: Array<{
    context: ApplicationContext;
    companyName: string;
    excludedCompanies: readonly string[];
    candidateProfile: CandidateProfile;
  }> = [];

  async submit(request: {
    context: ApplicationContext;
    companyName: string;
    excludedCompanies: readonly string[];
    candidateProfile: CandidateProfile;
  }): Promise<ApplicationSubmissionOutcome> {
    this.requests.push(request);
    return {
      submitted: true,
      safetyAllowed: true,
      reason: "Synthetic submission completed.",
      result: {
        submitted: true,
        externalApplicationId: "external-1",
        confirmationUrl: "https://example.com/confirmation",
        reason: "Synthetic submission completed."
      }
    };
  }
}

const candidateProfile: CandidateProfile = {
  id: "candidate-1",
  yearsExperience: 3,
  skills: ["React", "TypeScript"],
  targetTitles: ["Frontend Engineer"],
  firstName: "Salman",
  email: "salman@example.com"
};

function task(): ClaimedTask<{
  jobOpportunityId: string;
  candidateProfileId: string;
}> {
  return {
    id: "task-1",
    taskType: APPLY_JOB_TASK,
    payload: {
      jobOpportunityId: "job-1",
      candidateProfileId: "candidate-1"
    },
    status: "RUNNING",
    priority: 1000,
    availableAt: new Date(),
    lockedAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + 60_000),
    lockedBy: "worker-1",
    attempts: 1,
    maxAttempts: 3,
    dedupeKey: "apply:job-1:candidate-1",
    workerId: "worker-1"
  };
}

describe("ApplicationTaskHandler", () => {
  it("prepares an application and invokes browser submission with the resolved candidate profile", async () => {
    const applications = new FakeApplications();
    const submissions = new FakeSubmissionService();
    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      {
        async getById(id: string) {
          return id === candidateProfile.id ? candidateProfile : null;
        }
      },
      ["Octopus Technologies", "Sketch Brahma Technologies"]
    );

    await handler.handle(task());

    expect(submissions.requests).toEqual([
      {
        context: {
          jobOpportunityId: "job-1",
          candidateProfileId: "candidate-1",
          applicationId: "application-1",
          url: "https://example.com/apply"
        },
        companyName: "Example Corp",
        excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
        candidateProfile
      }
    ]);
  });

  it("does not submit when preparation is blocked", async () => {
    const applications = new FakeApplications();
    applications.prepared = false;
    const submissions = new FakeSubmissionService();
    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      {
        async getById() {
          return candidateProfile;
        }
      }
    );

    await handler.handle(task());

    expect(submissions.requests).toHaveLength(0);
  });

  it("throws when the candidate profile cannot be loaded", async () => {
    const applications = new FakeApplications();
    const submissions = new FakeSubmissionService();
    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      {
        async getById() {
          return null;
        }
      }
    );

    await expect(handler.handle(task())).rejects.toThrow(
      "Candidate profile 'candidate-1' could not be loaded."
    );
  });
});
