import { ApplicationContext } from "./ApplicationAdapter";
import { ApplicationEmailContext } from "../notifications/Email";
import { ApplicationSubmissionOutcome } from "./ApplicationSubmissionService";
import { ApplicationTaskHandler } from "./ApplicationTaskHandler";
import { APPLY_JOB_TASK } from "./ApplicationTask";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { ClaimedTask } from "../queue/TaskQueue";
import { TailoredResumeArtifactService } from "../resume/TailoredResumeArtifactService";
import { TailoredResumeRepository, TailoredResumeRecord } from "../resume/TailoredResumeRepository";
import { ApplicationAttemptRecord, StoredApplicationAttempt } from "./ApplicationAttemptRepository";

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
        jobTitle: "Frontend Engineer",
        companyName: "Example Corp",
        jobDescription: "React and TypeScript frontend role."
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
      adapterName: "greenhouse",
      result: {
        submitted: true,
        externalApplicationId: "external-1",
        confirmationUrl: "https://example.com/confirmation",
        reason: "Synthetic submission completed."
      }
    };
  }
}

class FakeApplicationAttemptRepository {
  records: ApplicationAttemptRecord[] = [];

  async record(record: ApplicationAttemptRecord): Promise<StoredApplicationAttempt> {
    this.records.push(record);
    return {
      ...record,
      id: "attempt-1",
      attemptedAt: record.attemptedAt ?? new Date(0)
    };
  }
}

class FakeTailoredResumeArtifacts {
  async create() {
    return {
      resumePath: "/tmp/tailored-resume.pdf",
      sourceVersion: "master-resume-v1",
      atsScore: 91,
      matchedKeywords: ["react", "typescript"],
      missingKeywords: ["aws"],
      warnings: ["AWS was not added because it is not supported by the master resume."]
    };
  }
}

class FakeTailoredResumeRepository implements TailoredResumeRepository {
  records: TailoredResumeRecord[] = [];

  async save(record: TailoredResumeRecord): Promise<void> {
    this.records.push(record);
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
        candidateProfile,
        taskId: "task-1",
        workerId: "worker-1",
        assertTaskOwnership: undefined
      }
    ]);
  });

  it("persists the application attempt outcome", async () => {
    const applications = new FakeApplications();
    const submissions = new FakeSubmissionService();
    const attempts = new FakeApplicationAttemptRepository();
    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      {
        async getById() {
          return candidateProfile;
        }
      },
      [],
      undefined,
      undefined,
      undefined,
      attempts
    );

    await handler.handle(task());

    expect(attempts.records).toEqual([
      {
        applicationId: "application-1",
        adapterName: "greenhouse",
        safetyAllowed: true,
        submitted: true,
        reason: "Synthetic submission completed.",
        failureCode: null,
        confirmationUrl: "https://example.com/confirmation",
        externalApplicationId: "external-1"
      }
    ]);
  });

  it("persists the tailored resume metadata and submits with the generated resume", async () => {
    const applications = new FakeApplications();
    const submissions = new FakeSubmissionService();
    const repository = new FakeTailoredResumeRepository();
    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      {
        async getById() {
          return candidateProfile;
        }
      },
      [],
      undefined,
      new FakeTailoredResumeArtifacts() as unknown as TailoredResumeArtifactService,
      repository
    );

    await handler.handle(task());

    expect(repository.records).toEqual([
      {
        applicationId: "application-1",
        jobOpportunityId: "job-1",
        candidateProfileId: "candidate-1",
        jobTitle: "Frontend Engineer",
        sourceVersion: "master-resume-v1",
        resumePath: "/tmp/tailored-resume.pdf",
        atsScore: 91,
        matchedKeywords: ["react", "typescript"],
        missingKeywords: ["aws"],
        warnings: ["AWS was not added because it is not supported by the master resume."]
      }
    ]);

    expect(submissions.requests[0]?.candidateProfile.resumePath).toBe("/tmp/tailored-resume.pdf");
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



  it("runs application-email discovery independently and prepares the email even when application submission fails", async () => {
    const applications = {
      async prepare() {
        return {
          prepared: true as const,
          application: {
            applicationId: "application-failure",
            jobOpportunityId: "job-1",
            candidateProfileId: "candidate-1",
            url: "https://example.com/apply",
            jobTitle: "Frontend Engineer",
            companyName: "Example Corp",
            companyDomain: "example.com",
            jobDescription: "React TypeScript frontend role."
          }
        };
      }
    };
    const submissions = {
      async submit() {
        return {
          submitted: false,
          safetyAllowed: false,
          outcome: "DEFINITIVE_FAILURE" as const,
          reason: "Application form unavailable.",
          adapterName: "greenhouse",
          result: { submitted: false, externalApplicationId: null, confirmationUrl: null, reason: "Application form unavailable." }
        };
      }
    };
    const emailDispatcher = {
      submitted: [] as ApplicationEmailContext[],
      blocked: [] as ApplicationEmailContext[],
      async enqueueApplicationSubmitted(context: ApplicationEmailContext) { this.submitted.push(context); return "email-submitted"; },
      async enqueueApplicationBlocked(context: ApplicationEmailContext) { this.blocked.push(context); return "email-blocked"; }
    };
    const discovery = {
      calls: 0,
      async discover() {
        this.calls++;
        return [{ email: "recruiter@example.com", fullName: "Example Recruiter", title: "Technical Recruiter" }];
      }
    };

    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      { async getById() { return candidateProfile; } },
      [],
      emailDispatcher,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      discovery
    );

    await handler.handle(task());

    expect(discovery.calls).toBe(1);
    expect(emailDispatcher.blocked).toHaveLength(1);
    expect(emailDispatcher.blocked[0]?.recipient).toBe("recruiter@example.com");
    expect(emailDispatcher.submitted).toHaveLength(0);
  });



  it("starts application-email discovery before an application runtime error and does not suppress the application error", async () => {
    const applications = {
      async prepare() {
        return {
          prepared: true as const,
          application: {
            applicationId: "application-error",
            jobOpportunityId: "job-1",
            candidateProfileId: "candidate-1",
            url: "https://example.com/apply",
            jobTitle: "Frontend Engineer",
            companyName: "Example Corp",
            companyDomain: "example.com",
            jobDescription: "React TypeScript frontend role."
          }
        };
      }
    };
    const submissions = { async submit() { throw new Error("Browser runtime failed."); } };
    const discovery = {
      calls: 0,
      async discover() { this.calls++; return []; }
    };
    const handler = new ApplicationTaskHandler(
      applications,
      submissions,
      { async getById() { return candidateProfile; } },
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      discovery
    );

    await expect(handler.handle(task())).rejects.toThrow("Browser runtime failed.");
    expect(discovery.calls).toBe(1);
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
