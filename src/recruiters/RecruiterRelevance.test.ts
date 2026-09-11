import { classifyRecruiterRelevance } from "./RecruiterRelevance";

const base = {
  verified: false,
  provider: "public-web",
  sources: []
};

describe("classifyRecruiterRelevance", () => {
  it("classifies explicit job-posting evidence as CURRENT", () => {
    const result = classifyRecruiterRelevance({
      ...base,
      fullName: "Alex Recruiter",
      sources: [{ type: "job_posting", confidence: 100 }]
    });
    expect(result.status).toBe("CURRENT");
    expect(result.score).toBe(100);
  });

  it("classifies explicit recent evidence as RECENT", () => {
    const result = classifyRecruiterRelevance({
      ...base,
      sources: [{ type: "recent_job_posting", confidence: 80 }]
    });
    expect(result.status).toBe("RECENT");
  });

  it("classifies explicit historical evidence as HISTORICAL", () => {
    const result = classifyRecruiterRelevance({
      ...base,
      sources: [{ type: "historical_role", confidence: 40 }]
    });
    expect(result.status).toBe("HISTORICAL");
  });

  it("keeps ordinary public search evidence UNKNOWN", () => {
    const result = classifyRecruiterRelevance({
      ...base,
      sources: [{ type: "public_linkedin_search", confidence: 90 }],
      discoveryEvidence: ["Recruiter at Acme"]
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.score).toBe(0);
  });
});
