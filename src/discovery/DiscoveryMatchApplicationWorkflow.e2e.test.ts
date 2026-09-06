import { ApplicationTaskDispatcher, APPLY_JOB_TASK } from "../applications/ApplicationTask";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { Job } from "../jobs/domain/Job";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { JobDiscoveryService } from "../jobs/services/JobDiscoveryService";
import { JobOpportunityRepository } from "../jobs/domain/JobOpportunityRepository";
import { JobSearchPolicy } from "../jobs/policy/JobEligibility";
import { JobRankingRepository } from "../jobs/policy/JobRankingRepository";
import { JobRankingService } from "../jobs/policy/JobRankingService";
import { DeterministicJobMatcher } from "../matching/DeterministicJobMatcher";
import { MatchDecisionRepository } from "../matching/MatchDecisionRepository";
import { MatchPipeline } from "../matching/MatchPipeline";
import { MatchTaskHandler } from "../matching/MatchTask";
import { DiscoveryMatchDispatcher } from "./queue/DiscoveryMatchDispatcher";
import { TaskQueue } from "../queue/TaskQueue";

interface StoredObservation {
  sourceJobId: string;
  contentHash: string;
}

class InMemoryDiscoveryDatabase {
  private readonly opportunities = new Map<string, { id: string; canonicalId: string }>();
  private readonly observations = new Map<string, StoredObservation>();
  private nextId = 1;

  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    const client = {
      query: async <TResult>(sql: string, params: unknown[]) => {
        if (sql.includes("INSERT INTO job_opportunities")) {
          const canonicalId = String(params[0]);
          let opportunity = this.opportunities.get(canonicalId);
          if (!opportunity) {
            opportunity = { id: `job-${this.nextId++}`, canonicalId };
            this.opportunities.set(canonicalId, opportunity);
          }
          return { rows: [{ id: opportunity.id }] as TResult[], rowCount: 1 };
        }

        if (sql.includes("INSERT INTO job_observations")) {
          const opportunityId = String(params[0]);
          const sourceJobId = String(params[3]);
          const contentHash = String(params[6]);
          const key = `${opportunityId}:${sourceJobId}:${contentHash}`;
          if (this.observations.has(key)) return { rows: [], rowCount: 0 };
          this.observations.set(key, { sourceJobId, contentHash });
          return { rows: [{ id: key }] as TResult[], rowCount: 1 };
        }

        throw new Error(`Unexpected discovery SQL: ${sql}`);
      }
    };

    return callback(client);
  }
}

class InMemoryMatchDecisionRepository implements MatchDecisionRepository {
  readonly decisions = new Map<string, { decision: string; score: number }>();

  async save(
    jobOpportunityId: string,
    candidateProfileId: string,
    result: { decision: "APPLY" | "REJECT" | "REVIEW"; matchScore: number },
  ): Promise<void> {
    this.decisions.set(`${jobOpportunityId}:${candidateProfileId}`, {
      decision: result.decision,
      score: result.matchScore
    });
  }
}

class InMemoryRankingRepository implements JobRankingRepository {
  readonly rankings = new Map<string, { tier: number; score: number }>();

  async save(input: any): Promise<void> {
    this.rankings.set(`${input.jobOpportunityId}:${input.candidateProfileId}`, {
      tier: input.ranking.tier,
      score: input.ranking.score
    });
  }
}

describe("discovery -> canonicalization/deduplication -> matching -> application queue", () => {
  const profile: CandidateProfile = {
    id: "candidate-1",
    yearsExperience: 3,
    skills: ["React.js", "TypeScript", "JavaScript"],
    targetTitles: ["Frontend Engineer"]
  };

  const policy: JobSearchPolicy = {
    priorityLocations: ["Bangalore", "Bengaluru"],
    targetCountry: "India",
    allowRemote: true,
    excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
    maxAgeDays: 30
  };

  function job(overrides: Partial<Job> = {}): Job {
    return {
      source: "synthetic",
      sourceJobId: "source-1",
      url: "https://jobs.example.com/frontend-engineer?utm_source=test",
      title: "Frontend Engineer",
      companyName: "Acme Software",
      location: "Bengaluru, Karnataka",
      country: "India",
      workplaceType: "hybrid",
      employmentType: "full-time",
      description: "React.js TypeScript JavaScript frontend engineering role.",
      postedAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: new Date("2026-09-01T00:00:00Z"),
      contentHash: "hash-1",
      ...overrides
    };
  }

  it("carries a newly discovered eligible job through matching and into the application task queue exactly once", async () => {
    const database = new InMemoryDiscoveryDatabase();
    const discovery = new JobDiscoveryService(database as never);
    const discoveredJob = job();
    const duplicateJob = job({
      sourceJobId: "source-1",
      url: "https://jobs.example.com/frontend-engineer?utm_campaign=ignored",
      contentHash: "hash-1"
    });

    const source = {
      name: "synthetic",
      fetchJobs: jest.fn().mockResolvedValue([discoveredJob, duplicateJob])
    };

    const discovered = await discovery.discover(source);

    expect(discovered.fetched).toBe(2);
    expect(discovered.inserted).toBe(1);
    expect(discovered.duplicates).toBe(1);
    expect(discovered.insertedOpportunityIds).toHaveLength(1);

    const opportunity: JobOpportunity = {
      id: discovered.insertedOpportunityIds[0],
      canonicalId: "synthetic-canonical",
      canonicalUrl: discoveredJob.url,
      title: discoveredJob.title,
      companyName: discoveredJob.companyName,
      location: discoveredJob.location,
      country: discoveredJob.country,
      workplaceType: discoveredJob.workplaceType,
      employmentType: discoveredJob.employmentType,
      description: discoveredJob.description,
      postedAt: discoveredJob.postedAt,
      sourceUpdatedAt: discoveredJob.updatedAt,
      lastSeenAt: new Date(),
      closedAt: null,
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date("2026-09-01T00:00:00Z")
    };

    const opportunities: JobOpportunityRepository = {
      findById: jest.fn().mockResolvedValue(opportunity)
    } as never;

    const matchTaskQueue = {
      enqueue: jest.fn().mockResolvedValue("match-task-1")
    } as unknown as TaskQueue;
    const matchDispatcher = new DiscoveryMatchDispatcher(
      opportunities,
      { enqueue: (id, candidateId, priority) => matchTaskQueue.enqueue({
        taskType: "MATCH_JOB",
        payload: { jobOpportunityId: id, candidateProfileId: candidateId },
        priority,
        dedupeKey: `match:${id}:${candidateId}`
      }) } as never,
      policy,
      profile.id
    );

    const dispatch = await matchDispatcher.dispatch(discovered.insertedOpportunityIds);
    expect(dispatch).toEqual({ enqueued: 1, rejected: 0, missing: 0 });

    const decisions = new InMemoryMatchDecisionRepository();
    const rankings = new InMemoryRankingRepository();
    const pipeline = new MatchPipeline(new DeterministicJobMatcher(), null, decisions);
    const ranking = new JobRankingService(policy, rankings);
    const handler = new MatchTaskHandler(opportunities, profile, pipeline, ranking);

    await handler.handle({
      id: "match-task-1",
      taskType: "MATCH_JOB",
      payload: {
        jobOpportunityId: opportunity.id,
        candidateProfileId: profile.id
      },
      attempts: 1,
      priority: 30,
      availableAt: new Date(),
      claimedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      workerId: "test-worker"
    });

    const decision = decisions.decisions.get(`${opportunity.id}:${profile.id}`);
    expect(decision?.decision).toBe("APPLY");
    expect(rankings.rankings.get(`${opportunity.id}:${profile.id}`)).toBeDefined();

    const applicationQueue = {
      enqueue: jest.fn().mockResolvedValue("apply-task-1")
    } as unknown as TaskQueue;
    const applicationDispatcher = new ApplicationTaskDispatcher(applicationQueue);
    await applicationDispatcher.enqueue(opportunity.id, profile.id, 1030);

    expect(applicationQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      taskType: APPLY_JOB_TASK,
      payload: {
        jobOpportunityId: opportunity.id,
        candidateProfileId: profile.id
      },
      dedupeKey: `apply:${opportunity.id}:${profile.id}`
    }));
  });

  it("keeps explicitly excluded companies out of the matching/application path", async () => {
    const opportunities: JobOpportunityRepository = {
      findById: jest.fn().mockResolvedValue({
        id: "excluded-job",
        companyName: "Sketch Brahma Technologies",
        location: "Bengaluru",
        country: "India",
        workplaceType: "onsite"
      })
    } as never;

    const matchTaskQueue = {
      enqueue: jest.fn()
    } as unknown as TaskQueue;
    const dispatcher = new DiscoveryMatchDispatcher(
      opportunities,
      { enqueue: (...args) => matchTaskQueue.enqueue(...args) } as never,
      policy,
      profile.id
    );

    await expect(dispatcher.dispatch(["excluded-job"])).resolves.toEqual({
      enqueued: 0,
      rejected: 1,
      missing: 0
    });
    expect(matchTaskQueue.enqueue).not.toHaveBeenCalled();
  });
});
