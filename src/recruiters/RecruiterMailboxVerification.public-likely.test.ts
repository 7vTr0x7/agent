import { isEligibleForRealRecruiterSend, isMailboxVerifiedForRealSend, isPlausibleMailboxAddress, isPubliclyLikelyForRealSend, recruiterRealSendEligibilitySql } from "./RecruiterMailboxVerification";

describe("public recruiter email eligibility", () => {
  const candidate = {
    verified: false,
    verificationStatus: "public-web-likely",
    emailStatus: "LIKELY",
    mailboxEvidence: false,
    verificationEvidence: [{ status: "public-web-likely", provider: "public-web", mailboxLevel: false, source: "public-hiring-evidence" }],
    relevanceStatus: "CURRENT",
    suppressed: false,
    email: "sneha.d@i-exceed.com",
    companyDomain: "i-exceed.com",
    provider: "proactive-public-web",
  };

  it("allows a current public company-domain address without calling it mailbox-verified", () => {
    expect(isPubliclyLikelyForRealSend(candidate)).toBe(true);
    expect(isMailboxVerifiedForRealSend(candidate)).toBe(false);
    expect(isEligibleForRealRecruiterSend(candidate)).toBe(true);
  });

  it("rejects public-likely when the address is not the employer domain", () => {
    expect(isPubliclyLikelyForRealSend({ ...candidate, email: "person@gmail.com" })).toBe(false);
  });

  it("rejects public-likely without explicit source evidence", () => {
    expect(isPubliclyLikelyForRealSend({ ...candidate, verificationEvidence: [] })).toBe(false);
  });

  it("allows public-likely contacts without current/recent relevance", () => {
    expect(isPubliclyLikelyForRealSend({ ...candidate, relevanceStatus: "HISTORICAL" })).toBe(true);
    expect(isPubliclyLikelyForRealSend({ ...candidate, relevanceStatus: "UNKNOWN" })).toBe(true);
  });

  it("rejects encoded search noise", () => {
    expect(isPlausibleMailboxAddress("22employer%20recruiting%20contact%22@indeed.com")).toBe(false);
  });

  it("exposes the public-likely SQL gate", () => {
    const sql = recruiterRealSendEligibilitySql("c");
    expect(sql).toContain("public-web-likely");
    expect(sql).toContain("c.verification_evidence");
    expect(sql).not.toContain("c.relevance_status");
    expect(sql).toContain("recruiter_suppressions");
  });
});
