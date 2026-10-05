import { isUsablePublicContactSource } from "./proactive-recruiter-contact-first-once";

describe("proactive recruiter contact source quality", () => {
  it("rejects job-board publishing/advertising pages as recruiter sources", () => {
    expect(isUsablePublicContactSource("https://jobicy.com/submit-guest-post", "pay@wrils.com")).toBe(false);
    expect(isUsablePublicContactSource("https://jobicy.com/pricing", "person@company.com")).toBe(false);
  });

  it("accepts first-party career/contact resources without requiring hiring evidence", () => {
    expect(isUsablePublicContactSource("https://infisical.com/careers", "team@infisical.com")).toBe(true);
    expect(isUsablePublicContactSource("https://example.com/contact", "person@other-company.com")).toBe(true);
  });

  it("accepts LinkedIn provenance and file resources", () => {
    expect(isUsablePublicContactSource("https://www.linkedin.com/posts/example_hiring-frontend-activity-123", "person@unknown-domain.com")).toBe(true);
    expect(isUsablePublicContactSource("file:///tmp/recruiters.pdf", "person@unknown-domain.com", "PDF")).toBe(true);
  });

  it("does not block unknown companies solely because the email domain is not known independently", () => {
    expect(isUsablePublicContactSource("https://unknown-company.example/contact", "recruiter@unknown-company.example")).toBe(true);
  });
});
