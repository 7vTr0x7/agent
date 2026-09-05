import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { MatchPipeline } from "./MatchPipeline";
import { MatchDecisionRepository } from "./MatchDecisionRepository";
import { SemanticJobMatcher } from "./SemanticJobMatcher";

const profile: CandidateProfile = {
  id: "candidate-1",
  yearsExperience: 3,
  skills: ["React", "TypeScript"],
  targetTitles: ["Frontend Engineer"]
};

const job: JobOpportunity = {
  id: "job-1",
  canonicalId: "canonical-1",
  canonicalUrl: "https://example.com/job-1",
  title: "Frontend Engineer",
  companyName: "Example",
  location: "Bengaluru",
  country: "India",
  workplaceType: "hybrid",
  employmentType: "full-time",
  description: "React and TypeScript application development.",
  postedAt: null,
  sourceUpdatedAt: new Date(),
  lastSeenAt: new Date(),
  closedAt: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date()
};

describe("MatchPipeline", () => {
  it("persists the deterministic result when no semantic matcher is configured", async () => {
    const saved: unknown[] = [];
    const repository: MatchDecisionRepository = {
      async save(...args) {
        saved.push(args);
      }
    };

    const pipeline = new MatchPipeline(new DeterministicJobMatcher(), null, repository);
    const result = await pipeline.evaluateAndPersist(job, profile);

    expect(result.decision).toBe("APPLY");
    expect(result.semantic).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it("combines deterministic and semantic scores", async () => {
    const repository: MatchDecisionRepository = {
      save: jest.fn().mockResolvedValue(undefined)
    };
    const semantic = {
      evaluate: jest.fn().mockResolvedValue({
        score: 80,
        decision: "APPLY",
        rationale: "Strong semantic fit",
        strengths: ["React ecosystem"],
        gaps: ["GraphQL"],
        confidence: 0.9,
        inputHash: "semantic-hash",
        model: "qwen3:8b"
      })
    } as unknown as SemanticJobMatcher;

    const pipeline = new MatchPipeline(new DeterministicJobMatcher(), semantic, repository);
    const result = await pipeline.evaluateAndPersist(job, profile);

    expect(result.semantic?.score).toBe(80);
    expect(result.score).toBe(86);
    expect(result.decision).toBe("APPLY");
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
