import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { AIProvider } from "../shared/types/ai";
import { SemanticJobMatcher } from "./SemanticJobMatcher";

const profile: CandidateProfile = {
  id: "candidate-1",
  yearsExperience: 3,
  skills: ["React", "TypeScript", "Next.js"],
  targetTitles: ["Frontend Engineer"]
};

const job: JobOpportunity = {
  id: "job-1", canonicalId: "c", canonicalUrl: "https://example.com/job",
  title: "Frontend Engineer", companyName: "Example", location: "Bengaluru",
  country: "India", workplaceType: "hybrid", employmentType: "full-time",
  description: "Build React and TypeScript applications.", postedAt: null,
  updatedAt: null, lastSeenAt: new Date(), closedAt: null, status: "ACTIVE",
  createdAt: new Date(), updatedAt: new Date()
};

describe("SemanticJobMatcher", () => {
  it("parses compact JSON and derives the final decision from the score", async () => {
    const provider: AIProvider = {
      complete: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          score: 82,
          decision: "REJECT",
          rationale: "Strong technical overlap.",
          strengths: ["React"],
          gaps: ["Node.js"],
          confidence: 0.9
        }),
        model: "test-model",
        durationMs: 10
      })
    };

    const result = await new SemanticJobMatcher(provider).evaluate(job, profile);

    expect(result.score).toBe(82);
    expect(result.decision).toBe("APPLY");
    expect(result.model).toBe("test-model");
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects malformed model output", async () => {
    const provider: AIProvider = {
      complete: jest.fn().mockResolvedValue({
        content: "not json",
        model: "test-model",
        durationMs: 10
      })
    };

    await expect(new SemanticJobMatcher(provider).evaluate(job, profile))
      .rejects.toThrow("invalid JSON");
  });
});
