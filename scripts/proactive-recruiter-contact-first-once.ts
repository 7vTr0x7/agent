import "dotenv/config";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../src/applications/ApplicationPolicy";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { isEligibleForRealRecruiterSend } from "../src/recruiters/RecruiterMailboxVerification";
import { isBlockedEmployerDomain } from "../src/recruiters/RecruiterCompanyDomainResolver";

type PublicContact = {
  id: string;
  company_name: string;
  company_domain: string;
  email: string;
  email_status: string;
  source_url: string | null;
  source_type: string | null;
  relevance_score: number | null;
  full_name: string | null;
};

function buildRecruiterGreeting(fullName?: string | null): string {
  const normalizedName = fullName?.trim().replace(/\s+/g, " ");
  if (!normalizedName) return "Hi Hiring Team,";
  const firstName = normalizedName.split(" ")[0];
  return firstName ? `Hi ${firstName},` : "Hi Hiring Team,";
}

function excludedCompany(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.trim().toLowerCase() === normalized);
}

const NON_CONTACT_SOURCE_HOSTS = new Set([
  "jobicy.com", "weworkremotely.com", "remoteok.com", "remoteok.io",
  "himalayas.app", "remotefirstjobs.com", "remoteyeah.com",
  "indeed.com", "glassdoor.com"
]);

const NON_CONTACT_SOURCE_PATHS = [
  /^\/submit-guest-post(?:\/|$)/i,
  /^\/post-a-job(?:\/|$)/i,
  /^\/post-job(?:\/|$)/i,
  /^\/advertis(?:e|ing)(?:\/|$)/i,
  /^\/sponsor(?:ship)?(?:\/|$)/i,
  /^\/pricing(?:\/|$)/i,
  /^\/(?:login|signup|sign-in|register)(?:\/|$)/i
];

const CONTACT_SOURCE_SIGNALS = /(?:career|careers|job|jobs|hiring|hire|recruit|recruiting|recruiter|talent|people|team|contact|about|profile|directory|resume|cv|apply)/i;

function registrableHost(value: string): string {
  const labels = value.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const suffix = labels.slice(-2).join(".");
  if (new Set(["co.uk", "org.uk", "ac.uk", "com.au", "co.in", "com.br"]).has(suffix)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

export function isUsablePublicContactSource(sourceUrl: string | null, email: string, sourceType?: string | null): boolean {
  const raw = sourceUrl?.trim() ?? "";
  if (!raw) return false;
  if (/^file:\/\//i.test(raw)) return true;

  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (!/^https?:$/i.test(parsed.protocol)) return false;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!host || !emailDomain) return false;

  const path = parsed.pathname.toLowerCase();
  if (NON_CONTACT_SOURCE_PATHS.some((pattern) => pattern.test(path))) return false;

  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return true;
  if (sourceType && /^(PDF|DOC|DOCX|XLS|XLSX|CSV|TXT|MD|FILE)$/i.test(sourceType)) return true;

  if (NON_CONTACT_SOURCE_HOSTS.has(host) || NON_CONTACT_SOURCE_HOSTS.has(registrableHost(host))) return false;

  return registrableHost(host) === registrableHost(emailDomain) || CONTACT_SOURCE_SIGNALS.test(path);
}

function buildMessage(fullName: string | null, profile: Awaited<ReturnType<ConfiguredCandidateProfileResolver["getById"]>>): { subject: string; body: string } {
  const candidateName = profile?.fullName?.trim() || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Candidate";
  const greeting = buildRecruiterGreeting(fullName);
  return {
    subject: `Full-Stack Developer — React, Next.js & Node.js — ${candidateName}`,
    body: [
      greeting,
      "",
      `My name is ${candidateName}, and I’m a Full-Stack Developer with ${profile?.yearsExperience ?? 0} years of experience, with a strong focus on React, Next.js, TypeScript, JavaScript, and Node.js/Express.`,
      "",
      "I’m currently exploring Full-Stack Developer opportunities where I can contribute across frontend development and backend/API work.",
      "",
      "I wanted to introduce myself and share my resume in case my background is relevant to any current or upcoming opportunities.",
      "",
      "I’ve attached my resume for reference. I’d be happy to share any additional information about my experience.",
      "",
      "Thank you for your time,",
      "",
      candidateName
    ].join("\\n")
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
              COALESCE(rc.company_domain,'') AS company_domain,
              canonical_contact.email,
              rc.email_status,
              canonical_contact.source_url,
              canonical_contact.source_type,
              canonical_contact.relevance_score,
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
      if (
        excludedCompany(contact.company_name) ||
        (domain && isBlockedEmployerDomain(domain)) ||
        !isUsablePublicContactSource(contact.source_url, email, contact.source_type) ||
        !isEligibleForRealRecruiterSend({ email, companyDomain: domain || null, emailStatus: contact.email_status, suppressed: false })
      ) {
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
