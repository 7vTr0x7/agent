import { buildContactPromotion } from "./promote-public-contact-resources-once";

describe("public contact promotion", () => {
  it("preserves public evidence and never claims mailbox verification", () => {
    const result = buildContactPromotion({
      resourceId: "resource-1",
      email: "Recruiter@Example.com",
      companyName: "Example Careers",
      sourceUrl: "https://example.com/careers/frontend",
      sourceType: "HTML",
      validationStatus: "LIKELY",
      relevanceScore: 85,
      evidenceContext: "We are hiring React developers. Send your resume to Recruiter@Example.com.",
      observedAt: "2026-09-26T06:00:00.000Z"
    });

    expect(result.email).toBe("recruiter@example.com");
    expect(result.validationStatus).toBe("LIKELY");
    expect(result.relevanceScore).toBe(85);
    expect(result.suppressed).toBe(false);
    expect(result.sourceUrl).toBe("https://example.com/careers/frontend");
    expect(result.provenance).toMatchObject({
      pipeline: "public_contact_resource",
      resourceId: "resource-1",
      sourceUrl: "https://example.com/careers/frontend",
      publicEvidence: true,
      mailboxVerification: "NOT_CLAIMED"
    });
    expect(String(result.provenance.evidenceContext)).toContain("hiring React developers");
  });
});
