import { formatEvidence } from "./public-hiring-posts-once";

describe("public hiring evidence formatting", () => {
  it("turns structured hiring evidence into readable text", () => {
    const text = formatEvidence({
      type: "job_hiring_evidence",
      source: "public-web",
      postUrl: "https://example.com/jobs/react",
      contactType: "PERSON",
      author: "Laura Korth",
      authorRole: "Senior Recruiting Specialist",
      employer: "Virtual7 GmbH",
      employerDomain: "virtual7.de",
      targetRoles: ["React Developer", "Frontend Engineer"],
      hiringEvidenceScore: 90,
      evidenceFreshness: "current",
      evidence: ["Erz\\u00e4hl mir, wer du bist.", "mailto:laura.korth@virtual7.de"]
    });

    expect(text).toContain("Person: Laura Korth");
    expect(text).toContain("Role: Senior Recruiting Specialist");
    expect(text).toContain("Employer: Virtual7 GmbH");
    expect(text).toContain("Target roles: React Developer, Frontend Engineer");
    expect(text).toContain("Erzähl mir, wer du bist.");
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("\\u00e4");
  });
});
