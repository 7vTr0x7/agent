import { createServer, Server } from "node:http";
import { ApplicationAdapter, ApplicationAdapterRegistry } from "./ApplicationAdapter";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationSubmissionService } from "./ApplicationSubmissionService";
import { ApplicationTaskHandler } from "./ApplicationTaskHandler";
import { APPLY_JOB_TASK } from "./ApplicationTask";
import { BrowserSessionService } from "./BrowserSession";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { TaskQueue } from "../queue/TaskQueue";
import { TaskWorker } from "../queue/TaskWorker";

class WorkflowAdapter implements ApplicationAdapter {
  readonly name = "workflow-adapter";
  submitted = false;

  canHandle(url: string): boolean {
    return /^http:\/\/127\.0\.0\.1:/i.test(url);
  }

  async submit(): Promise<{
    submitted: boolean;
    externalApplicationId: string | null;
    confirmationUrl: string | null;
    reason: string;
  }> {
    this.submitted = true;
    return {
      submitted: true,
      externalApplicationId: "external-workflow-1",
      confirmationUrl: "http://127.0.0.1/confirmation",
      reason: "Workflow submission completed."
    };
  }
}

class WorkflowApplications {
  async prepare() {
    return {
      prepared: true as const,
      application: {
        applicationId: "application-workflow-1",
        jobOpportunityId: "job-workflow-1",
        candidateProfileId: "candidate-workflow-1",
        url: this.url,
        jobTitle: "Frontend Engineer",
        companyName: "Example Corp",
        jobDescription: "React and TypeScript frontend role."
      }
    };
  }

  constructor(private readonly url: string) {}
}

class WorkflowApplicationRepository {
  beginCalls = 0;
  markSubmittedCalls: Array<{
    applicationId: string;
    confirmationUrl: string | null;
    externalApplicationId: string | null;
  }> = [];
  cancelCalls: Array<{ applicationId: string; reason: string }> = [];

  async beginSubmission(): Promise<boolean> {
    this.beginCalls += 1;
    return true;
  }

  async cancelSubmission(applicationId: string, reason: string): Promise<boolean> {
    this.cancelCalls.push({ applicationId, reason });
    return true;
  }

  async markSubmitted(
    applicationId: string,
    confirmationUrl: string | null,
    externalApplicationId: string | null
  ): Promise<{
    applicationId: string;
    confirmationUrl: string | null;
    externalApplicationId: string | null;
  }> {
    const result = { applicationId, confirmationUrl, externalApplicationId };
    this.markSubmittedCalls.push(result);
    return result;
  }
}

describe("application workflow end-to-end", () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <form>
          <label for="first-name">First Name</label>
          <input id="first-name" name="first_name" type="text" required />
          <label for="email">Email Address</label>
          <input id="email" name="email" type="email" required />
        </form>
      `);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
    url = `http://127.0.0.1:${address.port}/apply`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("processes a queued application task through preparation, browser safety, adapter submission, and confirmation", async () => {
    const adapter = new WorkflowAdapter();
    const applicationRepository = new WorkflowApplicationRepository();
    const submissionService = new ApplicationSubmissionService(
      new BrowserSessionService({ headless: true }),
      new ApplicationAdapterRegistry([adapter]),
      applicationRepository as unknown as ApplicationRepository
    );

    const candidateProfile: CandidateProfile = {
      id: "candidate-workflow-1",
      yearsExperience: 3,
      skills: ["React", "TypeScript"],
      targetTitles: ["Frontend Engineer"],
      firstName: "Salman",
      email: "salman@example.com"
    };

    const handler = new ApplicationTaskHandler(
      new WorkflowApplications(url),
      submissionService,
      {
        async getById(id: string) {
          return id === candidateProfile.id ? candidateProfile : null;
        }
      },
      ["Octopus Technologies", "Sketch Brahma Technologies"]
    );

    const task = {
      id: "task-workflow-1",
      taskType: APPLY_JOB_TASK,
      payload: {
        jobOpportunityId: "job-workflow-1",
        candidateProfileId: "candidate-workflow-1"
      },
      status: "RUNNING" as const,
      priority: 1000,
      availableAt: new Date(),
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lockedBy: "worker-workflow-1",
      attempts: 1,
      maxAttempts: 3,
      dedupeKey: "apply:job-workflow-1:candidate-workflow-1",
      workerId: "worker-workflow-1"
    };

    const queue = {
      recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }),
      claim: jest.fn().mockResolvedValue(task),
      heartbeat: jest.fn().mockResolvedValue(true),
      succeed: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue("SUCCEEDED")
    } as unknown as TaskQueue;

    const worker = new TaskWorker(
      queue,
      new Map([[APPLY_JOB_TASK, handler]]),
      { workerId: "worker-workflow-1", staleRecoveryIntervalMs: 60_000 }
    );

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(adapter.submitted).toBe(true);
    expect(applicationRepository.beginCalls).toBe(1);
    expect(applicationRepository.cancelCalls).toHaveLength(0);
    expect(applicationRepository.markSubmittedCalls).toEqual([
      {
        applicationId: "application-workflow-1",
        confirmationUrl: "http://127.0.0.1/confirmation",
        externalApplicationId: "external-workflow-1"
      }
    ]);
    expect(queue.succeed).toHaveBeenCalledWith("task-workflow-1", "worker-workflow-1");
    expect(queue.fail).not.toHaveBeenCalled();
  });
});
