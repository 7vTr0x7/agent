import { rankProactiveRecruiters } from "./ProactiveRecruiterRanking";

describe("rankProactiveRecruiters", () => {
  it("prefers fresh role-relevant hiring evidence and filters suppression", () => {
    const ranked = rankProactiveRecruiters([
      { id: "historical", roleMatchScore: 90, hiringEvidenceScore: 50, evidenceFreshnessScore: 40, employerRelevanceScore: 50, emailConfidenceScore: 90, locationRelevanceScore: 50 },
      { id: "current", roleMatchScore: 90, hiringEvidenceScore: 90, evidenceFreshnessScore: 100, employerRelevanceScore: 80, emailConfidenceScore: 100, locationRelevanceScore: 100 },
      { id: "suppressed", roleMatchScore: 100, hiringEvidenceScore: 100, evidenceFreshnessScore: 100, employerRelevanceScore: 100, emailConfidenceScore: 100, locationRelevanceScore: 100, suppressed: true }
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["current", "historical"]);
  });

  it("uses a deterministic id tie breaker", () => {
    const ranked = rankProactiveRecruiters([
      { id: "b", roleMatchScore: 50, hiringEvidenceScore: 50, evidenceFreshnessScore: 50, employerRelevanceScore: 50, emailConfidenceScore: 50, locationRelevanceScore: 50 },
      { id: "a", roleMatchScore: 50, hiringEvidenceScore: 50, evidenceFreshnessScore: 50, employerRelevanceScore: 50, emailConfidenceScore: 50, locationRelevanceScore: 50 }
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
