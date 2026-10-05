import { isEligibleForRealRecruiterSend, isMailboxVerifiedForRealSend, isPlausibleMailboxAddress, isRecruiterOutreachAddress, recruiterRealSendEligibilitySql, recruiterSimplePublicContactEligibilitySql } from "./RecruiterMailboxVerification";

describe("RecruiterMailboxVerification", () => {
  const verified = {
    email: "recruiter@company.com",
    companyDomain: "company.com",
    verified: true,
    verificationStatus: "mailbox_verified",
    emailStatus: "VERIFIED",
    mailboxEvidence: true,
    verificationEvidence: [{ status: "mailbox_verified", provider: "test", mailboxLevel: true, source: "mailbox-check" }],
    relevanceStatus: "CURRENT",
    suppressed: false
  };

  it("accepts genuine mailbox verification", () => expect(isMailboxVerifiedForRealSend(verified)).toBe(true));

  it("accepts real public mailboxes and rejects encoded/search-noise addresses", () => {
    expect(isPlausibleMailboxAddress("sneha.d@i-exceed.com")).toBe(true);
    expect(isPlausibleMailboxAddress("22employer%20recruiting%20contact%22%20%22indeed.com%22@indeed.com")).toBe(false);
    expect(isPlausibleMailboxAddress("22employer%20recruiting%20contact%22%20%22w3schools%22%20%22roadmap.sh%22@roadmap.sh")).toBe(false);
    expect(isPlausibleMailboxAddress("name..surname@example.com")).toBe(false);
    expect(isPlausibleMailboxAddress("name@example")).toBe(false);
  });

  it("accepts a usable unverified email without public-source or mailbox verification evidence", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "recruiter@company.com",
      companyDomain: "company.com",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "UNVERIFIED",
      verificationStatus: "unknown",
      verificationEvidence: [],
      relevanceStatus: "UNKNOWN",
      suppressed: false
    })).toBe(true);
  });

  it("accepts a usable email without a public source", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "recruiter@company.com",
      companyDomain: "company.com",
      provider: "internal-import",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "LIKELY",
      verificationStatus: "unverified",
      verificationEvidence: [],
      relevanceStatus: "HISTORICAL",
      suppressed: false
    })).toBe(true);
  });

  it("does not require mailbox verification, public-source evidence, or relevance", () => {
    const base = {
      email: "recruiter@company.com",
      companyDomain: "company.com",
      verified: false,
      mailboxEvidence: false,
      verificationEvidence: [],
      relevanceStatus: "UNKNOWN",
      suppressed: false
    };
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "UNVERIFIED", verificationStatus: "anything" })).toBe(true);
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "LIKELY", verificationStatus: "anything" })).toBe(true);
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "VERIFIED", verificationStatus: "anything" })).toBe(true);
  });

  it("rejects obvious non-recruiting transactional destinations while retaining recruiter mailboxes", () => {
    expect(isRecruiterOutreachAddress("srishti.shukla@innovationm.com")).toBe(true);
    expect(isRecruiterOutreachAddress("talent@company.com")).toBe(true);
    expect(isRecruiterOutreachAddress("pay@company.com")).toBe(false);
    expect(isRecruiterOutreachAddress("candidateprotection@company.com")).toBe(false);
    expect(isRecruiterOutreachAddress("u003ehiringaccommodation@mozilla.com")).toBe(false);
    expect(isRecruiterOutreachAddress("recruiter@company.com")).toBe(true);
  });

  it("rejects automated no-reply addresses", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "noreply@company.com",
      companyDomain: "company.com",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "UNVERIFIED",
      verificationStatus: "unknown",
      suppressed: false
    })).toBe(false);
  });

  it("rejects suppressed recipients", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "recruiter@company.com",
      companyDomain: "company.com",
      emailStatus: "UNVERIFIED",
      suppressed: true
    })).toBe(false);
  });

  it("rejects malformed and unsupported email states", () => {
    expect(isEligibleForRealRecruiterSend({ email: "not-an-email", emailStatus: "UNVERIFIED", suppressed: false })).toBe(false);
    expect(isEligibleForRealRecruiterSend({ email: "recruiter@company.com", emailStatus: "INVALID", suppressed: false })).toBe(false);
    expect(isEligibleForRealRecruiterSend({ email: "recruiter@company.com", emailStatus: undefined, suppressed: false })).toBe(false);
  });

  it("exposes the email-first SQL predicate", () => {
    const sql = recruiterRealSendEligibilitySql("c");
    expect(sql).not.toContain("c.mailbox_evidence");
    expect(sql).not.toContain("c.verification_evidence");
    expect(sql).not.toContain("jsonb_array_elements");
    expect(sql).toContain("c.email_status");
    expect(sql).toContain("c.suppressed");
    expect(sql).toContain("canonical_contact.email");
    expect(sql).toContain("noreply");
    expect(sql).toContain("candidateprotection");
    expect(sql).toContain("hiring[-_]?accommodation");
    expect(sql).toContain("recruiter_suppressions");

    const simpleSql = recruiterSimplePublicContactEligibilitySql("c");
    expect(simpleSql).not.toContain("c.mailbox_evidence");
    expect(simpleSql).not.toContain("c.verification_evidence");
    expect(simpleSql).toContain("c.email_status");
    expect(simpleSql).toContain("c.suppressed");
    expect(simpleSql).toContain("canonical_contact.email");
    expect(simpleSql).toContain("noreply");
    expect(simpleSql).toContain("candidateprotection");
    expect(simpleSql).toContain("hiring[-_]?accommodation");
    expect(simpleSql).toContain("recruiter_suppressions");
  });
});
