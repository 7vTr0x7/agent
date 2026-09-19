import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";

describe("ProactiveRecruiterDiscoveryService rejected-candidate diagnostics", () => {
  const profile = {
    id: "diagnostic-test",
    fullName: "Test Candidate",
    yearsExperience: 3,
    skills: ["React.js", "Next.js", "TypeScript"],
    targetRoles: ["React Developer", "Frontend Developer"],
    location: "Bengaluru, India",
    preferredLocations: ["Bengaluru", "India"],
    remoteEligible: true
  };

  test("captures rejected candidates with bounded, redacted evidence", async () => {
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/talent/person-${i}`);
    const page = `<html><title>Technical Recruiter</title><body>Technical Recruiter at Example Corp. Contact jane@example.com or +91 9876543210. ${urls.join(" ")}</body></html>`;
    const discovery = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      targetCandidates: 8,
      fetchText: async () => page
    });

    await discovery.discover(profile);
    const metrics = discovery.getLastRunMetrics();

    expect(metrics.rejectedCandidateDiagnostics).toHaveLength(20);
    expect(metrics.rejectedCandidateDiagnosticsTruncated).toBeGreaterThan(0);
    expect(metrics.rejectedCandidateDiagnostics[0]).toEqual(expect.objectContaining({
      provider: expect.any(String),
      queryIndex: 0,
      profileUrl: expect.stringContaining("https://example.com/talent/"),
      rejectionReasons: ["ROLE_IRRELEVANT"]
    }));
    expect(metrics.rejectedCandidateDiagnostics[0]?.profileEvidence).toContain("[email-redacted]");
    expect(metrics.rejectedCandidateDiagnostics[0]?.profileEvidence).toContain("[phone-redacted]");
    expect(JSON.stringify(metrics.rejectedCandidateDiagnostics)).not.toContain("jane@example.com");
    expect(JSON.stringify(metrics.rejectedCandidateDiagnostics)).not.toContain("9876543210");
  });

  test("accepted candidates are not added to rejected diagnostics", async () => {
    const page = "Jane Doe - Technical Recruiter at Example Corp actively hiring React frontend engineers in Bengaluru. https://linkedin.com/in/jane-doe jane@example.com";
    const discovery = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      targetCandidates: 1,
      fetchText: async () => page
    });

    const discovered = await discovery.discover(profile);
    const metrics = discovery.getLastRunMetrics();

    expect(discovered.length).toBeGreaterThan(0);
    expect(metrics.rejectedCandidateDiagnostics).toHaveLength(0);
  });
});
