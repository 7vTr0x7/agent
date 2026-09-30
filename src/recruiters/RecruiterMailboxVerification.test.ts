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
  it("accepts a legitimate company-domain address without mailbox verification or current/recent relevance", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "contact@company.com",
      companyDomain: "company.com",
      provider: "job-posting",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "UNVERIFIED",
      verificationStatus: "public-web-unverified",
      relevanceStatus: "CURRENT",
      suppressed: false,
    })).toBe(true);
    expect(isEligibleForRealRecruiterSend({
      email: "info@company.com",
      companyDomain: "company.com",
      provider: "proactive-public-web",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "LIKELY",
      verificationStatus: "public-web-likely",
      relevanceStatus: "RECENT",
      verificationEvidence: [{ provider: "public-web", status: "public-web-likely", mailboxLevel: false, source: "public-hiring-evidence" }],
      suppressed: false,
    })).toBe(true);
  });
  it("rejects automated no-reply company mailboxes", () => {
    expect(isEligibleForRealRecruiterSend({
      email: "noreply@company.com",
      companyDomain: "company.com",
      provider: "job-posting",
      verified: false,
      mailboxEvidence: false,
      emailStatus: "UNVERIFIED",
      verificationStatus: "public-web-unverified",
      relevanceStatus: "CURRENT",
      suppressed: false,
    })).toBe(false);
  });
  it("accepts company-domain addresses when hiring relevance is stale or unknown", () => {
    const base = { email: "contact@company.com", companyDomain: "company.com", provider: "job-posting", verified: false, mailboxEvidence: false, emailStatus: "UNVERIFIED", verificationStatus: "public-web-unverified", suppressed: false };
    expect(isEligibleForRealRecruiterSend({ ...base, relevanceStatus: "HISTORICAL" })).toBe(true);
    expect(isEligibleForRealRecruiterSend({ ...base, relevanceStatus: "UNKNOWN" })).toBe(true);
  });
  it("accepts a genuine relevant recruiter", () => expect(isEligibleForRealRecruiterSend(verified)).toBe(true));
  it.each([["MX only", { ...verified, mailboxEvidence: false, verificationStatus: "domain_mx_verified", emailStatus: "LIKELY" }],["verified boolean plus MX", { ...verified, mailboxEvidence: false, verificationStatus: "domain_mx_verified", emailStatus: "VERIFIED" }],["public source", { ...verified, mailboxEvidence: false, verificationStatus: "unverified_public_source", emailStatus: "UNVERIFIED" }],["verified public source", { ...verified, mailboxEvidence: false, verificationStatus: "verified_public_source", emailStatus: "VERIFIED" }],["MX DoH", { ...verified, mailboxEvidence: false, verificationStatus: "domain_mx_verified_doh", emailStatus: "LIKELY" }],["legacy verified mailbox alias without evidence", { ...verified, mailboxEvidence: false, verificationStatus: "verified_mailbox" }],["legacy valid without evidence", { ...verified, mailboxEvidence: false, verificationStatus: "valid" }],["empty verification evidence", { ...verified, verificationEvidence: [] }],["missing verification evidence", { ...verified, verificationEvidence: undefined }],["non-mailbox evidence only", { ...verified, verificationEvidence: [{ status: "VERIFIED", provider: "public-web", mailboxLevel: false, source: "public-search" }] }],["malformed evidence only", { ...verified, verificationEvidence: [{ mailboxLevel: true }] }],["noncanonical verified status with genuine evidence", { ...verified, verificationStatus: "verified" }],["suppressed", { ...verified, suppressed: true }]])("rejects %s", (_name, candidate) => expect(isEligibleForRealRecruiterSend(candidate)).toBe(false));
  it("rejects every candidate with raw verified=true when the canonical mailbox contract is incomplete", () => { expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, verificationEvidence: [] as unknown[], relevanceStatus: "CURRENT", suppressed: false })).toBe(false); expect(isEligibleForRealRecruiterSend({ verified: true, verificationStatus: "domain_mx_verified", emailStatus: "LIKELY", mailboxEvidence: false, verificationEvidence: [{ type: "mx" }], relevanceStatus: "CURRENT", suppressed: false })).toBe(false); });
  it("exposes the shared SQL predicate for verification, recipient, and suppression gates", () => { const sql = recruiterRealSendEligibilitySql("c"); expect(sql).toContain("c.mailbox_evidence"); expect(sql).toContain("c.verification_evidence"); expect(sql).toContain("jsonb_array_elements"); expect(sql).toContain("c.email_status"); expect(sql).toContain("c.verification_status"); expect(sql).not.toContain("c.relevance_status"); expect(sql).toContain("c.suppressed"); expect(sql).toContain("canonical_contact.email");
    expect(sql).toContain("SPLIT_PART(${emailSql},'@',1)"); expect(sql).toContain("noreply"); expect(sql).not.toContain("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"); expect(sql).toContain("recruiter_suppressions"); });
});
