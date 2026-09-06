import { RecruiterContactVerifier } from "./VerifiedRecruiterDiscoveryProvider";
import { VerifiedRecruiterDiscoveryProvider } from "./VerifiedRecruiterDiscoveryProvider";
import { RecruiterDiscoveryProvider } from "./RecruiterDiscovery";

describe("VerifiedRecruiterDiscoveryProvider", () => {
  it("verifies unverified discovery results before returning them", async () => {
    const discovery: RecruiterDiscoveryProvider = {
      name: "job-posting",
      discover: jest.fn().mockResolvedValue({
        provider: "job-posting",
        discoveredAt: new Date("2026-09-06T00:00:00Z"),
        contacts: [{
          email: "recruiter@example.com",
          confidence: 100,
          verified: false,
          verificationStatus: "unverified_public_source",
          provider: "job-posting",
          sources: [{ type: "job_posting" }]
        }]
      }),
      verify: jest.fn()
    };
    const verifier: RecruiterContactVerifier = {
      verify: jest.fn().mockResolvedValue({
        email: "recruiter@example.com",
        verified: true,
        status: "valid",
        confidence: 98
      })
    };

    const provider = new VerifiedRecruiterDiscoveryProvider(discovery, verifier);
    const result = await provider.discover({
      companyName: "Example",
      companyDomain: "example.com",
      jobTitle: "Frontend Engineer",
      jobDescription: "React",
      candidateProfileId: "candidate-1"
    });

    expect(result.provider).toBe("job-posting-verified");
    expect(result.contacts[0]).toMatchObject({
      email: "recruiter@example.com",
      verified: true,
      verificationStatus: "valid",
      confidence: 98
    });
    expect(verifier.verify).toHaveBeenCalledWith("recruiter@example.com");
  });

  it("does not re-verify contacts already marked verified", async () => {
    const discovery: RecruiterDiscoveryProvider = {
      name: "hunter",
      discover: jest.fn().mockResolvedValue({
        provider: "hunter",
        discoveredAt: new Date(),
        contacts: [{
          email: "recruiter@example.com",
          confidence: 96,
          verified: true,
          verificationStatus: "valid",
          provider: "hunter",
          sources: []
        }]
      }),
      verify: jest.fn()
    };
    const verifier = { verify: jest.fn() };
    const provider = new VerifiedRecruiterDiscoveryProvider(discovery, verifier);

    const result = await provider.discover({
      companyName: "Example",
      companyDomain: "example.com",
      jobTitle: "Frontend Engineer",
      jobDescription: "React",
      candidateProfileId: "candidate-1"
    });

    const contact = result.contacts[0];
    expect(contact).toBeDefined();
    expect(contact?.verified).toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });
});
