import { evaluateRecruiterOutreachSafety } from "./RecruiterOutreachSafetyGate";

describe("public-likely recruiter outreach safety", () => {
  const base = {
    companyName: "I Exceed",
    companyDomain: "i-exceed.com",
    contact: {
      email: "sneha.d@i-exceed.com",
      fullName: "Sneha D",
      confidence: 100,
      verified: false,
      verificationStatus: "public-web-likely",
      verificationEvidence: [{ provider: "public-web", status: "public-web-likely", mailboxLevel: false, source: "public-hiring-evidence" }],
      provider: "proactive-public-web",
      sources: [],
    },
    minConfidence: 80,
    requireVerifiedEmail: true,
    suppressedEmail: false,
    suppressedDomain: false,
    duplicateSequence: false,
    dryRun: true,
    relevanceStatus: "CURRENT" as const,
  };

  it("allows a current public company-domain email without claiming mailbox verification", () => {
    expect(evaluateRecruiterOutreachSafety(base).allowed).toBe(true);
  });

  it("still rejects an email from the wrong domain", () => {
    expect(evaluateRecruiterOutreachSafety({ ...base, contact: { ...base.contact, email: "person@gmail.com" } }).allowed).toBe(false);
  });

  it("still rejects stale recruiter evidence", () => {
    expect(evaluateRecruiterOutreachSafety({ ...base, relevanceStatus: "HISTORICAL" }).allowed).toBe(false);
  });
});
