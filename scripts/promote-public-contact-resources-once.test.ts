import { buildContactPromotion, isSafePublicEmail } from "./promote-public-contact-resources-once";

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

  it.each([
    "22employer%20recruiting%20contact%22@example.com",
    "recruiting@example.com%22",
    "recruiting@example.com%5C",
    "recruiting@example.com...",
    "recruiting@example.com)",
    "recruiting@example.com\""
  ])("rejects malformed/search-result email fragments: %s", (value) => {
    expect(isSafePublicEmail(value)).toBe(false);
    expect(() => buildContactPromotion({
      resourceId: "resource-1",
      email: value,
      companyName: "Example Careers",
      sourceUrl: "https://example.com/careers/frontend",
      sourceType: "HTML",
      validationStatus: "LIKELY",
      relevanceScore: 85,
      evidenceContext: "Hiring evidence",
      observedAt: "2026-09-26T06:00:00.000Z"
    })).toThrow("INVALID_PUBLIC_EMAIL");
  });

  it("accepts a legitimate recruiter email", () => {
    expect(isSafePublicEmail("laura.korth@virtual7.de")).toBe(true);
    expect(isSafePublicEmail("hr@perscitussln.com")).toBe(true);
    expect(isSafePublicEmail("recruiter@company.ai")).toBe(true);
  });

  it.each([
    "logo_nfl@3x.png",
    "logov1@2x-0a9767ad0b720e9e8dbd3eec46aae833a7a5a7d0a7759e7acc6bae0ac5c4fad6.png",
    "john.doe@acme.com",
    "recruiter@example.com"
  ])("rejects asset and placeholder addresses: %s", (value) => {
    expect(isSafePublicEmail(value)).toBe(false);
  });

  it("does not promote generic machine mailboxes as qualified public contacts", () => {
    expect(isSafePublicEmail("support@example.com")).toBe(false);
    expect(isSafePublicEmail("sales@example.com")).toBe(false);
  });
});
