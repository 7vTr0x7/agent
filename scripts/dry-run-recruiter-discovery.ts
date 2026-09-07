import "dotenv/config";
import { createRecruiterDiscoveryProvider, RecruiterDiscoveryProviderId } from "../src/recruiters/createRecruiterDiscoveryProvider";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function selectedProvider(): RecruiterDiscoveryProviderId {
  const configured = process.env.RECRUITER_TEST_PROVIDER?.trim() || process.env.RECRUITER_DISCOVERY_PROVIDER?.trim();
  if (configured === "hunter" || configured === "snov" || configured === "job-posting") return configured;
  return process.env.HUNTER_API_KEY?.trim() ? "hunter" : "job-posting";
}

async function main(): Promise<void> {
  const companyName = required("RECRUITER_TEST_COMPANY_NAME");
  const companyDomain = required("RECRUITER_TEST_COMPANY_DOMAIN");
  const jobTitle = process.env.RECRUITER_TEST_JOB_TITLE?.trim() || "Frontend Engineer";
  const jobDescription = process.env.RECRUITER_TEST_JOB_DESCRIPTION?.trim() || "Frontend engineering role using React and TypeScript.";
  const providerId = selectedProvider();

  const provider = createRecruiterDiscoveryProvider({
    provider: providerId,
    hunterApiKey: process.env.HUNTER_API_KEY?.trim() || null,
    snovClientId: process.env.SNOV_CLIENT_ID?.trim() || null,
    snovClientSecret: process.env.SNOV_CLIENT_SECRET?.trim() || null
  });

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
    note: providerId === "job-posting"
      ? "Public job-posting contacts are discovery-only and remain unverified until a verification provider confirms deliverability."
      : "Discovery completed without sending recruiter email. Real sending remains disabled by default.",
    contacts
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
