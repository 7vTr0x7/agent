import { FallbackRecruiterDiscoveryProvider } from "./FallbackRecruiterDiscoveryProvider";
import { RecruiterDiscoveryProvider } from "./RecruiterDiscovery";

function provider(name: string, contacts: Awaited<ReturnType<RecruiterDiscoveryProvider["discover"]>>["contacts"]): RecruiterDiscoveryProvider {
  return {
    name,
    discover: jest.fn().mockResolvedValue({ provider: name, contacts, discoveredAt: new Date() }),
    verify: jest.fn().mockResolvedValue({ email: "recruiter@example.com", verified: true, status: "valid", confidence: 99 })
  };
}

describe("FallbackRecruiterDiscoveryProvider", () => {
  it("uses verified primary contacts before the public-posting fallback", async () => {
    const primary = provider("snov", [{ email: "recruiter@example.com", verified: true, confidence: 95, provider: "snov", sources: [] }]);
    const fallback = provider("job-posting", [{ email: "hiring@example.com", verified: false, confidence: 100, provider: "job-posting", sources: [] }]);
    const combined = new FallbackRecruiterDiscoveryProvider(primary, fallback, primary);
    const result = await combined.discover({ companyName: "Example", companyDomain: "example.com", jobTitle: "Frontend Engineer", jobDescription: "", candidateProfileId: "candidate" });
    expect(result.contacts.map((contact) => contact.email)).toEqual(["recruiter@example.com"]);
    expect(fallback.discover).not.toHaveBeenCalled();
  });

  it("verifies public-posting contacts when the primary provider has no eligible contacts", async () => {
    const primary = provider("snov", []);
    const fallback = provider("job-posting", [{ email: "hiring@example.com", verified: false, confidence: 100, provider: "job-posting", sources: [{ type: "job_posting" }] }]);
    const verifier = provider("snov-verifier", []);
    verifier.verify = jest.fn().mockResolvedValue({ email: "hiring@example.com", verified: true, status: "valid", confidence: 97 });
    const combined = new FallbackRecruiterDiscoveryProvider(primary, fallback, verifier);
    const result = await combined.discover({ companyName: "Example", companyDomain: "example.com", jobTitle: "Frontend Engineer", jobDescription: "", candidateProfileId: "candidate" });
    expect(result.contacts[0]).toMatchObject({ email: "hiring@example.com", verified: true, confidence: 97, provider: "job-posting-verified" });
    expect(verifier.verify).toHaveBeenCalledWith("hiring@example.com");
  });
});
