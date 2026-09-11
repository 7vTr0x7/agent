import { isEligibleForRealRecruiterSend, isMailboxVerifiedForRealSend, recruiterRealSendEligibilitySql } from "./RecruiterMailboxVerification";

describe("RecruiterMailboxVerification", () => {
  const verified = { verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, verificationEvidence: [{ status: "smtp_valid", provider: "test" }], relevanceStatus: "CURRENT", suppressed: false };

  it("accepts genuine mailbox verification", () => expect(isMailboxVerifiedForRealSend(verified)).toBe(true));
  it("accepts a genuine relevant recruiter", () => expect(isEligibleForRealRecruiterSend(verified)).toBe(true));
  it.each([
    ["MX only", { ...verified, mailboxEvidence: false, verificationStatus: "domain_mx_verified", emailStatus: "LIKELY" }],
    ["verified boolean plus MX", { ...verified, mailboxEvidence: false, verificationStatus: "domain_mx_verified", emailStatus: "VERIFIED" }],
    ["public source", { ...verified, mailboxEvidence: false, verificationStatus: "unverified_public_source", emailStatus: "UNVERIFIED" }],
    ["verified public source", { ...verified, mailboxEvidence: false, verificationStatus: "verified_public_source", emailStatus: "VERIFIED" }],
    ["MX DoH", { ...verified, mailboxEvidence: false, verificationStatus: "domain_mx_verified_doh", emailStatus: "LIKELY" }],
    ["legacy verified mailbox alias without evidence", { ...verified, mailboxEvidence: false, verificationStatus: "verified_mailbox" }],
    ["legacy valid without evidence", { ...verified, mailboxEvidence: false, verificationStatus: "valid" }],
    ["empty verification evidence", { ...verified, verificationEvidence: [] }],
    ["missing verification evidence", { ...verified, verificationEvidence: undefined }],
    ["suppressed", { ...verified, suppressed: true }],
    ["unknown relevance", { ...verified, relevanceStatus: "UNKNOWN" }],
    ["historical relevance", { ...verified, relevanceStatus: "HISTORICAL" }]
  ])("rejects %s", (_name, candidate) => expect(isEligibleForRealRecruiterSend(candidate)).toBe(false));

  it("rejects every candidate with raw verified=true when the canonical mailbox contract is incomplete", () => {
    expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, verificationEvidence: [] as unknown[], relevanceStatus: "CURRENT", suppressed: false })).toBe(false);
    expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "domain_mx_verified", emailStatus: "LIKELY", mailboxEvidence: false, verificationEvidence: [{ type: "mx" }], relevanceStatus: "CURRENT", suppressed: false })).toBe(false);
  });

  it("exposes one SQL predicate for DB-backed eligibility", () => {
    const sql = recruiterRealSendEligibilitySql("c");
    expect(sql).toContain("c.mailbox_evidence");
    expect(sql).toContain("c.verification_evidence");
    expect(sql).toContain("jsonb_array_length");
    expect(sql).toContain("c.email_status");
    expect(sql).toContain("c.verification_status");
    expect(sql).toContain("c.relevance_status");
    expect(sql).toContain("c.suppressed");
  });
});
