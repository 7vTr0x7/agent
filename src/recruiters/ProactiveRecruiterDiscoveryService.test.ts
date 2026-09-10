import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("ProactiveRecruiterDiscoveryService", () => {
  it("builds recruiter searches from candidate roles and skills without requiring a job", () => {
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => null });
    const queries = service.buildQueries({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toContain("frontend engineer");
    expect(queries[0]).toContain("react");
  });

  it("accepts role-relevant public evidence and keeps discovered email unverified", async () => {
    const html = `Jane Doe - Technical Recruiter hiring React and frontend engineers <https://linkedin.com/in/jane-doe> jane@example.com`;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.roleMatchScore).toBeGreaterThan(0);
    expect(results[0]?.email).toBe("jane@example.com");
    expect(results[0]?.emailStatus).toBe("UNVERIFIED");
    expect(results[0]?.discoverySource).toBe("public-web");
  });

  it("does not discover generic recruiters without target-role evidence", async () => {
    const html = `Jane Doe - Recruiter <https://linkedin.com/in/jane-doe>`;
    const service = new ProactiveRecruiterDiscoveryService({ fetchText: async () => html });
    const results = await service.discover({ targetRoles: ["Frontend Engineer"], skills: ["React"] });
    expect(results).toEqual([]);
  });
});
