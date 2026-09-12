import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("Phase 10 recruiter hiring-evidence honesty", () => {
  const profile = { targetTitles: ["React Developer", "Frontend Engineer"], skills: ["React", "Next.js", "TypeScript"], yearsExperience: 3, preferredLocations: ["Bengaluru", "India", "Remote"], remoteEligible: true };
  it("does not turn recruiter identity into a current-hiring claim", async () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => "Jane Doe - Technical Recruiter at Example Corp. React frontend recruiting professional. https://linkedin.com/in/jane-doe", now: () => new Date("2026-09-13T00:00:00Z"), maxQueries: 1 });
    const results = await service.discover(profile);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.evidenceType).toBe("public_profile");
    expect(results[0]?.hiringEvidenceScore).toBe(0);
    expect(results[0]?.evidenceFreshness).toBe("unknown");
  });
  it("classifies explicit current hiring evidence separately", async () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => "Jane Doe - Technical Recruiter at Example Corp. We are currently hiring React engineers. https://linkedin.com/in/jane-doe", now: () => new Date("2026-09-13T00:00:00Z"), maxQueries: 1 });
    const results = await service.discover(profile);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.evidenceType).toBe("job_hiring_evidence");
    expect(results[0]?.hiringEvidenceScore).toBeGreaterThan(0);
    expect(results[0]?.evidenceFreshness).toBe("current");
  });
});
