import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { MatchPipeline } from "./MatchPipeline";
import { MatchDecisionRepository } from "./MatchDecisionRepository";
import { SemanticJobMatcher } from "./SemanticJobMatcher";

const profile: CandidateProfile = { id: "candidate-1", yearsExperience: 3, skills: ["React", "TypeScript"], targetTitles: ["Frontend Engineer"] };
const job: JobOpportunity = { id: "job-1", canonicalId: "canonical-1", canonicalUrl: "https://example.com/job-1", title: "Frontend Engineer", companyName: "Example", location: "Bengaluru", country: "India", workplaceType: "hybrid", employmentType: "full-time", description: "React and TypeScript application development.", postedAt: null, sourceUpdatedAt: new Date(), lastSeenAt: new Date(), closedAt: null, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() };

describe("MatchPipeline", () => {
  it("persists the deterministic result when no semantic matcher is configured", async () => {
    const saved: unknown[] = []; const repository: MatchDecisionRepository = { async save(...args) { saved.push(args); } }; const result = await new MatchPipeline(new DeterministicJobMatcher(), null, repository).evaluateAndPersist(job, profile);
    expect(result.decision).toBe("APPLY"); expect(result.semantic).toBeNull(); expect(saved).toHaveLength(1);
  });
  it("keeps the deterministic decision when semantic matching fails", async () => {
    const repository: MatchDecisionRepository = { save: jest.fn().mockResolvedValue(undefined) }; const semantic = { evaluate: jest.fn().mockRejectedValue(new Error("Ollama unavailable")) } as unknown as SemanticJobMatcher; const result = await new MatchPipeline(new DeterministicJobMatcher(), semantic, repository).evaluateAndPersist(job, profile);
    expect(result.score).toBeGreaterThanOrEqual(30); expect(result.decision).toBe("APPLY"); expect(result.semantic).toBeNull(); expect(result.confidence).toBe(0.75); expect(result.reason).toContain("AI assessment unavailable"); expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ type: "AI_FALLBACK" })])); expect(repository.save).toHaveBeenCalledWith(job.id, profile.id, expect.objectContaining({ decision: "APPLY", evaluator: "DETERMINISTIC_FALLBACK" }), expect.any(String));
  });
  it("combines deterministic and semantic scores using the current weighted scoring", async () => {
    const repository: MatchDecisionRepository = { save: jest.fn().mockResolvedValue(undefined) }; const semantic = { evaluate: jest.fn().mockResolvedValue({ score: 80, decision: "APPLY", rationale: "Strong semantic fit", strengths: ["React ecosystem"], gaps: ["GraphQL"], confidence: 0.9, inputHash: "semantic-hash", model: "qwen3:8b" }) } as unknown as SemanticJobMatcher; const result = await new MatchPipeline(new DeterministicJobMatcher(), semantic, repository).evaluateAndPersist(job, profile);
    expect(result.semantic?.score).toBe(80); expect(result.score).toBe(Math.round(result.deterministic.matchScore * 0.6 + 80 * 0.4)); expect(result.decision).toBe("APPLY"); expect(repository.save).toHaveBeenCalledTimes(1);
  });
  it("does not let semantic matching upgrade a deterministic REVIEW into APPLY", async () => {
    const reviewJob = {
      ...job,
      description: "React and TypeScript application development. Compensation ₹3-5 LPA."
    };
    const repository: MatchDecisionRepository = { save: jest.fn().mockResolvedValue(undefined) };
    const semantic = {
      evaluate: jest.fn().mockResolvedValue({
        score: 100,
        decision: "APPLY",
        rationale: "Strong semantic fit",
        strengths: ["React ecosystem"],
        gaps: [],
        confidence: 0.99,
        inputHash: "semantic-hash",
        model: "qwen3:8b"
      })
    } as unknown as SemanticJobMatcher;

    const result = await new MatchPipeline(new DeterministicJobMatcher(), semantic, repository)
      .evaluateAndPersist(reviewJob, profile);

    expect(result.deterministic.decision).toBe("REVIEW");
    expect(result.decision).toBe("REVIEW");
    expect(result.score).toBeGreaterThan(30);
  });
});
