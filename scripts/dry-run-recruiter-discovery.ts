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

  const contacts = result.contacts.map((contact) => ({
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

  const sendEligible = result.contacts.filter((contact) =>
    contact.verified && (contact.confidence ?? 0) >= 80
  ).length;

  console.log(JSON.stringify({
    dryRun: true,
    provider: result.provider,
    companyName,
    companyDomain,
    jobTitle,
    discovered: result.contacts.length,
    sendEligible,
    note: "Public-web discovery only. No recruiter email is sent by this command. Public contacts remain unverified until an approved verification provider confirms deliverability.",
    contacts
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
