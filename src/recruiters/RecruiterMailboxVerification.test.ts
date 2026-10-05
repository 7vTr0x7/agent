import { isEligibleForRealRecruiterSend, isMailboxVerifiedForRealSend, isPlausibleMailboxAddress, recruiterRealSendEligibilitySql } from "./RecruiterMailboxVerification";

describe("RecruiterMailboxVerification", () => {
  const verified = { verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, verificationEvidence: [{ status: "mailbox_verified", provider: "test", mailboxLevel: true, source: "mailbox-check" }], relevanceStatus: "CURRENT", suppressed: false };
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
      suppressed: false,
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
      suppressed: false,
    })).toBe(true);
  });
  it("rejects automated no-reply addresses", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "noreply@company.com",
      companyDomain: "company.com",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "UNVERIFIED",
      verificationStatus: "unknown",
      suppressed: false,
    })).toBe(false);
  });
  it("accepts a genuine relevant recruiter", () => expect(isEligibleForRealRecruiterSend(verified)).toBe(true));
  it("does not require mailbox verification, public-source evidence, or relevance", () => {
    const base = {
      email: "recruiter@company.com",
      companyDomain: "company.com",
      verified: false,
      mailboxEvidence: false,
      verificationEvidence: [],
      relevanceStatus: "UNKNOWN",
      suppressed: false,
    };
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "UNVERIFIED", verificationStatus: "anything" })).toBe(true);
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "LIKELY", verificationStatus: "anything" })).toBe(true);
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "VERIFIED", verificationStatus: "anything" })).toBe(true);
  });
  it("rejects every candidate with raw verified=true when the canonical mailbox contract is incomplete", () => { expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, verificationEvidence: [] as unknown[], relevanceStatus: "CURRENT", suppressed: false })).toBe(false); expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "domain_mx_verified", emailStatus: "LIKELY", mailboxEvidence: false, verificationEvidence: [{ type: "mx" }], relevanceStatus: "CURRENT", suppressed: false })).toBe(false); });
  it("exposes the email-first SQL predicate", () => {
    const sql = recruiterRealSendEligibilitySql("c");
    expect(sql).not.toContain("c.mailbox_evidence");
    expect(sql).not.toContain("c.verification_evidence");
    expect(sql).not.toContain("jsonb_array_elements");
    expect(sql).toContain("c.email_status");
    expect(sql).toContain("c.suppressed");
    expect(sql).toContain("canonical_contact.email");
    expect(sql).toContain("noreply");
    expect(sql).toContain("recruiter_suppressions");
  });rt { isEligibleForRealRecruiterSend, isMailboxVerifiedForRealSend, isPlausibleMailboxAddress, recruiterRealSendEligibilitySql } from "./RecruiterMailboxVerification";

describe("RecruiterMailboxVerification", () => {
  const verified = { verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, verificationEvidence: [{ status: "mailbox_verified", provider: "test", mailboxLevel: true, source: "mailbox-check" }], relevanceStatus: "CURRENT", suppressed: false };
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
      suppressed: false,
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
      suppressed: false,
    })).toBe(true);
  });
  it("rejects automated no-reply addresses", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "noreply@company.com",
      companyDomain: "company.com",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "UNVERIFIED",
      verificationStatus: "unknown",
      suppressed: false,
    })).toBe(false);
  });
  it("accepts a genuine relevant recruiter", () => expect(isEligibleForRealRecruiterSend(verified)).toBe(true));
  it("does not require mailbox verification, public-source evidence, or relevance", () => {
    const base = {
      email: "recruiter@company.com",
      companyDomain: "company.com",
      verified: false,
      mailboxEvidence: false,
      verificationEvidence: [],
      relevanceStatus: "UNKNOWN",
      suppressed: false,
    };
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "UNVERIFIED", verificationStatus: "anything" })).toBe(true);
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "LIKELY", verificationStatus: "anything" })).toBe(true);
    expect(isEligibleForRealRecruiterSend({ ...base, emailStatus: "VERIFIED", verificationStatus: "anything" })).toBe(true);
  });
  it("rejects every candidate with raw verified=true when the canonical mailbox contract is incomplete", () => { expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, verificationEvidence: [] as unknown[], relevanceStatus: "CURRENT", suppressed: false })).toBe(false); expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "domain_mx_verified", emailStatus: "LIKELY", mailboxEvidence: false, verificationEvidence: [{ type: "mx" }], relevanceStatus: "CURRENT", suppressed: false })).toBe(false); });
  it("exposes the shared SQL predicate for verification, recipient, and suppression gates", () => { const sql = recruiterRealSendEligibilitySql("c"); expect(sql).toContain("c.mailbox_evidence"); expect(sql).toContain("c.verification_evidence"); expect(sql).toContain("jsonb_array_elements"); expect(sql).toContain("c.email_status"); expect(sql).toContain("c.verification_status"); expect(sql).not.toContain("c.relevance_status"); expect(sql).toContain("c.suppressed"); expect(sql).toContain("canonical_contact.email");
    expect(sql).toContain("SPLIT_PART((SELECT canonical_contact.email FROM contacts canonical_contact WHERE canonical_contact.id=c.contact_id),'@',1)"); expect(sql).toContain("noreply"); expect(sql).not.toContain("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"); expect(sql).toContain("recruiter_suppressions"); });
});
