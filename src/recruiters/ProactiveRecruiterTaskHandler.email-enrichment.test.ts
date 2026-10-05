import { buildContactFirstMessage, isCompatibleRecruiterEnrichmentEmail } from "./ProactiveRecruiterTaskHandler";

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


describe("contact-first recruiter email formatting", () => {
  it("uses real line breaks instead of literal escaped newline sequences", () => {
    const body = buildContactFirstMessage("Salman Shaikh", 3, null);

    expect(body).toContain("Hi Hiring Team,\n\nMy name is Salman Shaikh");
    expect(body).not.toContain("\\n");
  });
});
