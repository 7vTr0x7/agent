import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { DeterministicMatchResult, promoteKnownRemoteBoardMatch } from "./MatchPipeline";

function result(overrides: Partial<DeterministicMatchResult> = {}): DeterministicMatchResult {
  return {
    matchScore: 68,
    decision: "REVIEW",
    matchedSkills: ["React", "TypeScript"],
    missingSkills: [],
    evidence: [],
    reason: "2 skills matched; role=FRONTEND; geography=UNKNOWN; seniority=UNKNOWN; freshness=VERY_RECENT.",
    geography: "UNKNOWN",
    freshness: "VERY_RECENT",
    seniority: "UNKNOWN",
    technicalOrientation: "FRONTEND",
    ...overrides
  };
}

function job(overrides: Partial<JobOpportunity> = {}): JobOpportunity {
  return {
    id: "remote-board-test",
    canonicalId: "remote-board-test-canonical",
    canonicalUrl: "https://remoteok.com/remote-jobs/frontend-engineer-example",
    title: "Frontend Engineer",
    companyName: "Example",
    location: null,
    country: null,
    workplaceType: "remote",
    employmentType: "full-time",
    description: "React and TypeScript required.",
    postedAt: new Date("2026-09-28T00:00:00Z"),
    sourceUpdatedAt: null,
    lastSeenAt: new Date("2026-09-28T00:00:00Z"),
    closedAt: null,
    status: "ACTIVE",
    createdAt: new Date("2026-09-28T00:00:00Z"),
    updatedAt: new Date("2026-09-28T00:00:00Z"),
    url: "https://remoteok.com/remote-jobs/frontend-engineer-example",
    ...overrides
  };
}

describe("promoteKnownRemoteBoardMatch", () => {
  it("promotes a strong unknown-geography match from a known remote board", () => {
    const promoted = promoteKnownRemoteBoardMatch(result(), job());

    expect(promoted.decision).toBe("APPLY");
    expect(promoted.geography).toBe("REMOTE_WORLDWIDE");
  });

  it("does not promote an ordinary unknown-geography job", () => {
    const promoted = promoteKnownRemoteBoardMatch(
      result(),
      job({ canonicalUrl: "https://example.com/jobs/frontend-engineer", url: "https://example.com/jobs/frontend-engineer" })
    );

    expect(promoted.decision).toBe("REVIEW");
    expect(promoted.geography).toBe("UNKNOWN");
  });

  it("does not promote a remote-board job with an explicit foreign restriction", () => {
    const promoted = promoteKnownRemoteBoardMatch(
      result(),
      job({ description: "React and TypeScript required. Remote from the United States only." })
    );

    expect(promoted.decision).toBe("REVIEW");
    expect(promoted.geography).toBe("UNKNOWN");
  });

  it("does not promote a weak match even when the source is remote-first", () => {
    const promoted = promoteKnownRemoteBoardMatch(result({ matchScore: 59 }), job());

    expect(promoted.decision).toBe("REVIEW");
  });
});
