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
    const urls = Array.from({ length: 25 }, (_, i) => `https://93.184.216.34/talent/person-${i}`);
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
      profileUrl: expect.stringContaining("https://93.184.216.34/talent/"),
      rejectionReasons: ["ROLE_IRRELEVANT"]
    }));
    expect(metrics.rejectedCandidateDiagnostics[0]?.profileEvidence).toContain("[email-redacted]");
    expect(metrics.rejectedCandidateDiagnostics[0]?.profileEvidence).toContain("[phone-redacted]");
    expect(JSON.stringify(metrics.rejectedCandidateDiagnostics)).not.toContain("jane@example.com");
    expect(JSON.stringify(metrics.rejectedCandidateDiagnostics)).not.toContain("9876543210");
  });

  test("accepted candidates are not added to rejected diagnostics", async () => {
    const page = "Jane Doe - Technical Recruiter at Example Corp actively hiring React frontend engineers in Bengaluru. https://example.com/talent/jane-doe jane@example.com";
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
  test("rejects malformed nested recruiter URLs before profile fetch and deduplicates repeated occurrences", async () => {
    const malformed = "https://www.upwork.com/hire/technical-recruiters/in/https://www.upwork.com%E2%80%BAhire%E2%80%BAtechnical-recruiters%E2%80%BAin";
    const nested = "https://example.com/talent/https://other.example/path";
    const encodedNested = "https://example.com/talent/https%3A%2F%2Fother.example%2Fpath";
    const legitimate = "https://example.com/talent/jane-doe";
    const searchPage = `Jane Doe - Technical Recruiter at Example Corp actively hiring React frontend engineers in Bengaluru.
      ${malformed}
      ${malformed}
      ${nested}
      ${encodedNested}
      ${legitimate}`;
    const calls:string[] = [];
    const discovery = new ProactiveRecruiterDiscoveryService({
      maxQueries: 1,
      targetCandidates: 1,
      fetchText: async (url) => {
        calls.push(url);
        return url === legitimate
          ? "<html><head><title>Jane Doe | Technical Recruiter | Example Corp</title></head><body><h1>Jane Doe</h1><p>Technical Recruiter at Example Corp actively hiring React frontend engineers in Bengaluru.</p></body></html>"
          : searchPage;
      }
    });

    const discovered = await discovery.discover(profile);
    const metrics = discovery.getLastRunMetrics();
    const malformedDiagnostics = metrics.rejectedCandidateDiagnostics.filter(d => d.rejectionReasons.includes("MALFORMED_NESTED_URL"));

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.discoveryUrl).toBe(legitimate);
    expect(calls).not.toContain(malformed);
    expect(calls).not.toContain(nested);
    expect(calls).not.toContain(encodedNested);
    expect(malformedDiagnostics).toHaveLength(3);
    expect(malformedDiagnostics[0]?.candidateUrl).toBe(malformed);
    expect(malformedDiagnostics[0]?.directFetch.attempted).toBe(false);
    expect(malformedDiagnostics[0]?.fallback.attempted).toBe(false);
    expect(metrics.rejectionReasons["MALFORMED_NESTED_URL"]).toBeGreaterThanOrEqual(3);
  });

});

// Public recruiter acquisition regression coverage remains intentionally network-independent.
