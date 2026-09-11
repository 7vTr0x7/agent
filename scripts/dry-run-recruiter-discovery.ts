import "dotenv/config";
import { createRecruiterDiscoveryProvider } from "../src/recruiters/createRecruiterDiscoveryProvider";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const companyName = required("RECRUITER_TEST_COMPANY_NAME");
  const companyDomain = required("RECRUITER_TEST_COMPANY_DOMAIN");
  const jobTitle = process.env.RECRUITER_TEST_JOB_TITLE?.trim() || "Frontend Engineer";
  const jobDescription = process.env.RECRUITER_TEST_JOB_DESCRIPTION?.trim() || "Frontend engineering role using React and TypeScript.";

  const provider = createRecruiterDiscoveryProvider({ provider: "public-web" });
  const result = await provider.discover({
    companyName,
    companyDomain,
    jobTitle,
    jobDescription,
    candidateProfileId: "dry-run-candidate",
    jobOpportunityId: "dry-run-opportunity",
    applicationId: "dry-run-application"
  });

  const verifiedContacts = await Promise.all(result.contacts.map(async (contact) => {
    if (contact.verificationStatus === "VERIFIED" && contact.verified) return contact;
    if (!contact.email) return contact;
    try {
      const verification = await provider.verify(contact.email);
      return {
        ...contact,
        // Public-web verification intentionally cannot claim mailbox-level proof.
        // Keep verified=false for MX-only results; a future authorized mailbox
        // verifier may explicitly return VERIFIED when it has mailbox evidence.
        verified: verification.status === "VERIFIED",
        verificationStatus: verification.status,
        emailStatus: verification.status,
        confidence: Math.min(100, Math.max(contact.confidence ?? 0, verification.confidence ?? 0))
      };
    } catch {
      return { ...contact, verified: false, verificationStatus: "UNVERIFIED", emailStatus: "UNVERIFIED" as const };
    }
  }));

  const contacts = verifiedContacts.map((contact) => ({
    email: contact.email,
    fullName: contact.fullName,
    title: contact.title,
    department: contact.department,
    seniority: contact.seniority,
    country: contact.country,
    location: contact.location,
    confidence: contact.confidence,
    verified: contact.verified,
    verificationStatus: contact.verificationStatus,
    emailStatus: contact.emailStatus,
    linkedinProfileUrl: contact.linkedinProfileUrl,
    sourceCount: contact.sources?.length ?? 0
  }));

  const sendEligible = verifiedContacts.filter((contact) =>
    contact.verified && contact.verificationStatus === "VERIFIED" && (contact.confidence ?? 0) >= 80
  ).length;

  console.log(JSON.stringify({
    dryRun: true,
    provider: result.provider,
    companyName,
    companyDomain,
    jobTitle,
    discovered: verifiedContacts.length,
    sendEligible,
    note: "Public-web discovery never upgrades an address to VERIFIED from MX alone. LIKELY means the destination domain advertises an MX receiver; VERIFIED requires mailbox-level evidence from an authorized verifier. This command never sends recruiter email.",
    contacts
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
