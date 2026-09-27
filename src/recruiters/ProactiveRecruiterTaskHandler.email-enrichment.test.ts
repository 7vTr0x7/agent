import { isCompatibleRecruiterEnrichmentEmail } from "./ProactiveRecruiterTaskHandler";

describe("recruiter email enrichment domain safety", () => {
  it("accepts an employer-domain enrichment email", () => {
    expect(isCompatibleRecruiterEnrichmentEmail("jane@acme.example", "acme.example")).toBe(true);
  });

  it("accepts generic mailbox enrichment without treating it as an employer identity", () => {
    expect(isCompatibleRecruiterEnrichmentEmail("jane@gmail.com", "acme.example")).toBe(true);
  });

  it("rejects a non-generic enrichment email that contradicts the employer domain", () => {
    expect(isCompatibleRecruiterEnrichmentEmail("jane@agency.example", "acme.example")).toBe(false);
  });
});
