import { createServer, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { ApplicationAdapter, ApplicationAdapterRegistry } from "./ApplicationAdapter";
import { ApplicationAttemptRepository } from "./ApplicationAttemptRepository";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationSubmissionService } from "./ApplicationSubmissionService";
import { ApplicationTaskHandler } from "./ApplicationTaskHandler";
import { APPLY_JOB_TASK } from "./ApplicationTask";
import { BrowserSessionService } from "./BrowserSession";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { Database } from "../database/Database";
import { MigrationRunner } from "../database/MigrationRunner";
import { TaskQueue } from "../queue/TaskQueue";
import { TaskWorker } from "../queue/TaskWorker";

class PostgresWorkflowAdapter implements ApplicationAdapter {
  readonly name = "postgres-workflow-adapter";
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
      externalApplicationId: "external-postgres-workflow-1",
      confirmationUrl: "http://127.0.0.1/confirmation",
      reason: "PostgreSQL workflow submission completed."
    };
  }
}

describe("application workflow with PostgreSQL persistence", () => {
  const databaseUrl = process.env.DATABASE_URL;
  const runIntegration = databaseUrl ? describe : describe.skip;

  let database: Database;
  let server: Server;
  let url: string;
  let jobOpportunityId: string;
  let jobId: string;
  let candidateProfileId: string;

  runIntegration("when DATABASE_URL is configured", () => {
    beforeAll(async () => {
      database = new Database(databaseUrl!);
      await new MigrationRunner(database).run();

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
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port.");
      }
      url = `http://127.0.0.1:${address.port}/apply`;

      jobOpportunityId = randomUUID();
      jobId = randomUUID();
      candidateProfileId = `candidate-${randomUUID()}`;

      await database.query(
        `
          INSERT INTO job_opportunities (
            id, canonical_id, canonical_url, title, company_name, location,
            country, workplace_type, employment_type, description
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          jobOpportunityId,
          `postgres-e2e-${jobOpportunityId}`,
          url,
          "Frontend Engineer",
          "Postgres Workflow Corp",
          "Bengaluru, India",
          "India",
          "hybrid",
          "full-time",
          "React and TypeScript frontend role."
        ]
      );

      await database.query(
        `
          INSERT INTO jobs (
            id, source, source_job_id, url, title, company_name, location,
            country, workplace_type, employment_type, description, content_hash,
            job_opportunity_id
          )
          VALUES ($1, 'postgres-e2e', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          jobId,
          `postgres-source-${jobId}`,
          url,
          "Frontend Engineer",
          "Postgres Workflow Corp",
          "Bengaluru, India",
          "India",
          "hybrid",
          "full-time",
          "React and TypeScript frontend role.",
          `postgres-content-${jobId}`.padEnd(64, "0"),
          jobOpportunityId
        ]
      );

      await database.query(
        `
          INSERT INTO match_decisions (
            job_opportunity_id, candidate_profile_id, decision, match_score,
            matched_skills, missing_skills, evidence, reason, evaluator
          )
          VALUES ($1, $2, 'APPLY', 95, $3::jsonb, '[]'::jsonb, $4::jsonb, $5, 'deterministic')
        `,
        [
          jobOpportunityId,
          candidateProfileId,
          JSON.stringify(["React", "TypeScript"]),
          JSON.stringify(["Strong frontend stack match"]),
          "Strong match for the candidate profile."
        ]
      );

      await database.query(
        `
          INSERT INTO job_rankings (
            job_opportunity_id, candidate_profile_id, rank_score, tier,
            location_score, match_score, freshness_bonus, reason
          )
          VALUES ($1, $2, 95, 1, 100, 95, 5, $3)
        `,
        [jobOpportunityId, candidateProfileId, "High-priority Bengaluru frontend opportunity."]
      );
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        if (!server) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      });

      if (database) {
        await database.query("DELETE FROM applications WHERE job_opportunity_id = $1", [jobOpportunityId]);
        await database.query("DELETE FROM job_rankings WHERE job_opportunity_id = $1", [jobOpportunityId]);
        await database.query("DELETE FROM match_decisions WHERE job_opportunity_id = $1", [jobOpportunityId]);
        await database.query("DELETE FROM jobs WHERE id = $1", [jobId]);
        await database.query("DELETE FROM job_opportunities WHERE id = $1", [jobOpportunityId]);
        await database.close();
      }
    });

    it("persists the complete queued application flow in PostgreSQL", async () => {
      const candidateProfile: CandidateProfile = {
        id: candidateProfileId,
        yearsExperience: 3,
        skills: ["React", "TypeScript"],
        targetTitles: ["Frontend Engineer"],
        firstName: "Salman",
        email: "salman@example.com"
      };

      const adapter = new PostgresWorkflowAdapter();
      const applications = new ApplicationRepository(database, [
        "Octopus Technologies",
        "Sketch Brahma Technologies"
      ]);
      const attempts = new ApplicationAttemptRepository(database);
      const submissionService = new ApplicationSubmissionService(
        new BrowserSessionService({ headless: true }),
        new ApplicationAdapterRegistry([adapter]),
        applications
      );

      const handler = new ApplicationTaskHandler(
        applications,
        submissionService,
        {
          async getById(id: string) {
            return id === candidateProfile.id ? candidateProfile : null;
          }
        },
        ["Octopus Technologies", "Sketch Brahma Technologies"],
        undefined,
        undefined,
        undefined,
        attempts
      );

      const queue = new TaskQueue(database);
      const taskId = await queue.enqueue({
        taskType: APPLY_JOB_TASK,
        payload: {
          jobOpportunityId,
          candidateProfileId
        },
        priority: 1000,
        dedupeKey: `postgres-apply:${jobOpportunityId}:${candidateProfileId}`
      });

      const worker = new TaskWorker(
        queue,
        new Map([[APPLY_JOB_TASK, handler]]),
        {
          workerId: `postgres-worker-${randomUUID()}`,
          staleRecoveryIntervalMs: 60_000,
          heartbeatIntervalMs: 60_000
        }
      );

      await expect(worker.runOnce()).resolves.toBe(true);

      const application = await database.query<{
        id: string;
        status: string;
        applied_at: Date | null;
      }>(
        `SELECT id, status, applied_at FROM applications WHERE job_opportunity_id = $1`,
        [jobOpportunityId]
      );
      expect(application.rows).toHaveLength(1);
      expect(application.rows[0]?.status).toBe("SENT");
      expect(application.rows[0]?.applied_at).not.toBeNull();

      const events = await database.query<{ event_type: string; to_status: string }>(
        `SELECT event_type, to_status FROM application_events WHERE application_id = $1 ORDER BY created_at ASC, id ASC`,
        [application.rows[0]!.id]
      );
      expect(events.rows.map((event) => event.event_type)).toEqual([
        "APPLICATION_PREPARED",
        "APPLICATION_SUBMISSION_STARTED",
        "APPLICATION_SUBMITTED"
      ]);
      expect(events.rows.map((event) => event.to_status)).toEqual([
        "READY",
        "SUBMISSION_IN_PROGRESS",
        "SENT"
      ]);

      const storedAttempts = await attempts.listForApplication(application.rows[0]!.id);
      expect(storedAttempts).toHaveLength(1);
      expect(storedAttempts[0]).toMatchObject({
        adapterName: "postgres-workflow-adapter",
        safetyAllowed: true,
        submitted: true,
        confirmationUrl: "http://127.0.0.1/confirmation",
        externalApplicationId: "external-postgres-workflow-1"
      });

      const task = await database.query<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM tasks WHERE id = $1`,
        [taskId]
      );
      expect(task.rows[0]).toEqual({ status: "SUCCEEDED", attempts: 1 });
      expect(adapter.submitted).toBe(true);

      const duplicateTaskId = await queue.enqueue({
        taskType: APPLY_JOB_TASK,
        payload: { jobOpportunityId, candidateProfileId },
        priority: 1000,
        dedupeKey: `postgres-apply:${jobOpportunityId}:${candidateProfileId}`
      });
      expect(duplicateTaskId).not.toBe(taskId);
    });
  });
});
