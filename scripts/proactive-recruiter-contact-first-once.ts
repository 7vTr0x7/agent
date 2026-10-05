import "dotenv/config";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../src/applications/ApplicationPolicy";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { isPlausibleMailboxAddress } from "../src/recruiters/RecruiterMailboxVerification";
import { isBlockedEmployerDomain } from "../src/recruiters/RecruiterCompanyDomainResolver";

type PublicContact = {
  id: string;
  company_name: string;
  company_domain: string;
  email: string;
  source_url: string | null;
  full_name: string | null;
};

function excludedCompany(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.trim().toLowerCase() === normalized);
}

function buildMessage(fullName: string | null, profile: Awaited<ReturnType<ConfiguredCandidateProfileResolver["getById"]>>): { subject: string; body: string } {
  const candidateName = profile?.fullName?.trim() || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Candidate";
  const greeting = fullName?.trim() ? `Hi ${fullName.trim().split(/\\s+/)[0]},` : "Hi there,";
  return {
    subject: `Frontend / Full-Stack Engineer — React & Next.js — ${candidateName}`,
    body: [
      greeting,
      "",
      `My name is ${candidateName}, and I’m a Frontend Engineer with ${profile?.yearsExperience ?? 0} years of experience building web applications with React, Next.js, TypeScript, JavaScript, Redux Toolkit, and Node.js/Express.`,
      "",
      "I’m currently exploring Frontend Engineer, React/Next.js Developer, and Full-Stack Developer opportunities.",
      "",
      "I’m reaching out proactively to introduce myself rather than assume that you or your team are currently hiring. If you work with roles that align with my background, I’d appreciate it if you could keep my profile in mind or point me toward the appropriate opportunity.",
      "",
      "I’ve attached my resume for reference and would be happy to provide any additional information.",
      "",
      "Thank you for your time and consideration.",
      "",
      candidateName
    ].join("\n")
  };
}

async function main(): Promise<void> {
  const database = new Database(process.env.DATABASE_URL ?? "");
  try {
    const resolver = ConfiguredCandidateProfileResolver.fromEnvironment();
    const profile = await resolver.getById(process.env.CANDIDATE_PROFILE_ID?.trim() ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const maxCandidates = Math.max(1, Number(process.env.PROACTIVE_RECRUITER_TARGET_CANDIDATES ?? 25));
    const rows = await database.query<PublicContact>(
      `SELECT rc.id,
              rc.company_name,
              COALESCE(NULLIF(rc.company_domain,''), split_part(canonical_contact.email,'@',2)) AS company_domain,
              canonical_contact.email,
              canonical_contact.source_url,
              rc.full_name
         FROM recruiter_contacts rc
         JOIN contacts canonical_contact ON canonical_contact.id=rc.contact_id
        WHERE COALESCE(rc.suppressed,FALSE)=FALSE
          AND COALESCE(canonical_contact.suppressed,FALSE)=FALSE
          AND rc.discovery_source='public-contact-resource'
          AND canonical_contact.email IS NOT NULL
        ORDER BY rc.last_seen_at DESC NULLS LAST, rc.updated_at DESC
        LIMIT $1`,
      [maxCandidates * 5]
    );

    const repository = new ProactiveRecruiterRepository(database);
    let candidates = 0;
    let rejected = 0;
    let prepared = 0;
    let skippedExisting = 0;
    const persisted: Array<{ recruiterContactId: string; email: string; company: string; sourceUrl: string | null }> = [];
    const queued: string[] = [];

    for (const contact of rows.rows) {
      if (candidates >= maxCandidates) break;
      const email = contact.email.trim().toLowerCase();
      const domain = contact.company_domain.trim().toLowerCase();
      if (!isPlausibleMailboxAddress(email) || !domain || isBlockedEmployerDomain(domain) || excludedCompany(contact.company_name)) {
        rejected += 1;
        continue;
      }

      candidates += 1;
      const message = buildMessage(contact.full_name, profile);
      const campaign = await repository.createProactiveCampaign({
        recruiterContactId: contact.id,
        candidateProfileId: profile.id,
        targetRoles: [...profile.targetTitles],
        subject: message.subject,
        body: message.body,
        reusePrepared: true
      });

      if (!campaign) {
        skippedExisting += 1;
        continue;
      }

      prepared += 1;
      persisted.push({ recruiterContactId: contact.id, email, company: contact.company_name, sourceUrl: contact.source_url });
      if (process.env.PROACTIVE_RECRUITER_SEND_ENABLED === "true") queued.push(campaign.messageId);
    }

    console.log(JSON.stringify({
      status: "ok",
      operationalStatus: "SUCCESS",
      feature: "PUBLIC_CONTACT_FIRST_PROACTIVE_RECRUITER",
      live: process.env.RECRUITER_OUTREACH_ACTIVATION === "live" && process.env.RECRUITER_LIVE_ACTIVATION_CONFIRMED === "true",
      sendEnabled: process.env.PROACTIVE_RECRUITER_SEND_ENABLED === "true",
      activation: process.env.RECRUITER_OUTREACH_ACTIVATION ?? "disabled",
      metrics: { publicContactsConsidered: rows.rows.length, candidates, rejected, skippedExisting, prepared, queued: queued.length },
      persisted,
      preparedMessages: persisted.map((item) => ({ email: item.email, company: item.company, sourceUrl: item.sourceUrl })),
      queued
    }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", feature: "PUBLIC_CONTACT_FIRST_PROACTIVE_RECRUITER", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
