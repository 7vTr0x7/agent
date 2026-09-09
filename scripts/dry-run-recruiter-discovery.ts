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
    if (contact.verified) return contact;
    try {
      const verification = await provider.verify(contact.email);
      if (!verification.verified) return contact;
      return {
        ...contact,
        verified: true,
        verificationStatus: verification.status,
        confidence: Math.min(100, Math.max(contact.confidence ?? 0, verification.confidence ?? 0))
      };
    } catch {
      return contact;
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
    linkedinProfileUrl: contact.linkedinProfileUrl,
    sourceCount: contact.sources?.length ?? 0
  }));

  const sendEligible = verifiedContacts.filter((contact) =>
    contact.verified && (contact.confidence ?? 0) >= 80
  ).length;

  console.log(JSON.stringify({
    dryRun: true,
    provider: result.provider,
    companyName,
    companyDomain,
    jobTitle,
    discovered: verifiedContacts.length,
    sendEligible,
    note: "Public-web discovery plus free domain-MX deliverability verification. verified=true means the employer domain accepts mail via MX; it does not claim that the individual mailbox exists. This command never sends recruiter email.",
    contacts
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
