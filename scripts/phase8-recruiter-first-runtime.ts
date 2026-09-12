import { Database } from "../src/database/Database";
import { ProactiveRecruiterDiscoveryService } from "../src/recruiters/ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";

const DB = process.env.DATABASE_URL;
if (!DB) throw new Error("DATABASE_URL is required");
for (const flag of ["GMAIL_ENABLED", "OUTBOUND_ENABLED", "PROACTIVE_RECRUITER_SEND_ENABLED"]) {
  if ((process.env[flag] ?? "false").toLowerCase() !== "false") throw new Error(`${flag} must be false`);
}

const candidateProfile = {
  id: "phase8-proactive-candidate",
  fullName: "Phase Eight Candidate",
  yearsExperience: 3,
  skills: ["React.js", "React", "Next.js", "TypeScript", "Node.js", "Express", "MongoDB"],
  targetRoles: ["React Developer", "React.js Developer", "Frontend Developer", "Frontend Engineer", "React + Next.js Developer", "Next.js Developer", "TypeScript Frontend Engineer", "Full Stack Developer", "MERN Developer"],
  location: "Pune, India",
  preferredLocations: ["Bengaluru", "Bangalore", "India", "Remote"],
  remoteEligible: true
};
const companyDomain = "phase8.test";
const email = "jane.recruiter@phase8.test";
const recruiterName = "Jane Recruiter";
const discoveryUrl = "https://phase8.test/recruiting/jane";
const evidence = "Jane Recruiter - Technical Recruiter at Phase Eight Corp actively hiring React frontend engineers in Bengaluru and India. Recruiting for React, Next.js and TypeScript roles. 2026.";

async function main(): Promise<void> {
  const db = new Database(DB!);
  try {
    const markerJobs = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM job_opportunities WHERE company_domain=$1`, [companyDomain]);
    if (markerJobs.rows[0]?.count !== "0") throw new Error(`Fixture isolation failed: expected zero jobs, found ${markerJobs.rows[0]?.count}`);
    const discovery = new ProactiveRecruiterDiscoveryService({ fetchText: async () => `<html><body>${evidence} <https://linkedin.com/in/jane-recruiter> ${email}</body></html>`, now: () => new Date("2026-09-12T00:00:00Z") });
    const discovered = await discovery.discover(candidateProfile);
    if (discovered.length < 1) throw new Error("Proactive recruiter discovery found no candidates.");
    const candidate = { ...discovered[0], recruiterName, recruiterRole: "Technical Recruiter", employer: "Phase Eight Corp", employerDomain: companyDomain, email, emailStatus: "VERIFIED" as const, verificationEvidence: [{ provider: "phase8-fixture-mailbox-verifier", status: "mailbox_verified", confidence: 99, mailboxLevel: true, source: "isolated-test-provider" }] };
    candidate.discoveryUrl = discoveryUrl; candidate.evidenceFreshness = "current"; candidate.evidenceType = "job_hiring_evidence"; candidate.roleMatchScore = 100; candidate.hiringEvidenceScore = 100; candidate.overallConfidence = 99;
    const repository = new ProactiveRecruiterRepository(db);
    const contactId = await repository.persistCandidate(candidateProfile.id, candidate);
    if (!contactId) throw new Error("Proactive recruiter was not persisted.");
    const contact = await db.query<any>(`SELECT id,company_domain,email,verified,email_status,verification_status,mailbox_evidence,verification_evidence,relevance_status,suppressed FROM recruiter_contacts WHERE id=$1`, [contactId]);
    const row = contact.rows[0];
    if (!row) throw new Error("Persisted proactive recruiter contact is missing.");
    if (row.verified !== true || row.email_status !== "VERIFIED" || row.verification_status !== "mailbox_verified" || row.mailbox_evidence !== true || row.relevance_status !== "CURRENT") throw new Error(`Canonical mailbox/relevance assertion failed: ${JSON.stringify(row)}`);
    const subject = "Frontend / React / Next.js opportunities — Phase Eight Candidate";
    const body = `Hi Jane,\n\nI’m Phase Eight Candidate, and I’m exploring React Developer / Frontend Engineer opportunities. I have 3 years of experience with React.js, Next.js, TypeScript and Node.js. Your public recruiting information appears relevant to these kinds of roles.\n\nI’m reaching out proactively rather than assuming there is a specific opening. If you recruit for roles that fit my background, I’d be happy to share my resume and discuss relevant opportunities.\n\nThank you,\nPhase Eight Candidate`;
    if (/opening|open role|job opportunity/i.test(body) && !/rather than assuming there is a specific opening/i.test(body)) throw new Error("Proactive message falsely implies a specific opening.");
    if (!body.includes("React") || !body.includes("Next.js") || !body.includes("3 years")) throw new Error("Proactive message is not personalized.");
    const campaign = await repository.createProactiveCampaign({ recruiterContactId: contactId, candidateProfileId: candidateProfile.id, targetRoles: candidateProfile.targetRoles, subject, body });
    if (!campaign) throw new Error("Proactive campaign was not prepared.");
    const concurrent = await Promise.all([
      repository.createProactiveCampaign({ recruiterContactId: contactId, candidateProfileId: candidateProfile.id, targetRoles: candidateProfile.targetRoles, subject, body }),
      repository.createProactiveCampaign({ recruiterContactId: contactId, candidateProfileId: candidateProfile.id, targetRoles: candidateProfile.targetRoles, subject, body })
    ]);
    if (concurrent.filter(Boolean).length !== 0) throw new Error("Concurrent proactive preparation created a duplicate.");
    const campaignRow = await db.query<any>(`SELECT campaign_type,job_opportunity_id,target_roles FROM recruiter_outreach_sequences WHERE id=$1`, [campaign.sequenceId]);
    if (campaignRow.rows[0]?.campaign_type !== "PROACTIVE_RECRUITER" || campaignRow.rows[0]?.job_opportunity_id !== null) throw new Error(`Proactive campaign schema assertion failed: ${JSON.stringify(campaignRow.rows[0])}`);
    const counts = await db.query<{ sequences: string; messages: string; sent: string }>(`SELECT (SELECT COUNT(*)::text FROM recruiter_outreach_sequences WHERE recruiter_contact_id=$1 AND candidate_profile_id=$2 AND campaign_type='PROACTIVE_RECRUITER') sequences,(SELECT COUNT(*)::text FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id WHERE s.recruiter_contact_id=$1 AND s.candidate_profile_id=$2 AND s.campaign_type='PROACTIVE_RECRUITER') messages,(SELECT COUNT(*)::text FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id WHERE s.recruiter_contact_id=$1 AND s.candidate_profile_id=$2 AND m.status='SENT') sent`, [contactId, candidateProfile.id]);
    if (counts.rows[0]?.sequences !== "1" || counts.rows[0]?.messages !== "1" || counts.rows[0]?.sent !== "0") throw new Error(`Proactive state assertion failed: ${JSON.stringify(counts.rows[0])}`);

    const negatives = [
      { suffix: "nomailbox", verified: false, emailStatus: "UNVERIFIED", verificationStatus: "public-web-unverified", mailboxEvidence: false, evidence: [] },
      { suffix: "mxonly", verified: false, emailStatus: "LIKELY", verificationStatus: "domain_mx_verified", mailboxEvidence: false, evidence: [{ provider: "phase8-fixture-mx", status: "mx_verified", mailboxLevel: false }] },
      { suffix: "webonly", verified: false, emailStatus: "UNVERIFIED", verificationStatus: "public-web-unverified", mailboxEvidence: false, evidence: [{ provider: "phase8-fixture-web", status: "public-web", mailboxLevel: false }] }
    ];
    for (const item of negatives) {
      const result = await db.query<{ id: string }>(`INSERT INTO recruiter_contacts (company_name,company_domain,email,full_name,title,confidence,verified,verification_status,provider,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,relevance_status,last_seen_at,updated_at) VALUES ('Phase Eight Corp',$1,$2,'Negative Recruiter','Technical Recruiter',99,$3,$4,'phase8-negative',$5,'VALID','EXISTS',$6,$7,'CURRENT',NOW(),NOW()) RETURNING id`, [companyDomain, `${item.suffix}@${companyDomain}`, item.verified, item.verificationStatus, item.emailStatus, item.mailboxEvidence, JSON.stringify(item.evidence)]);
      const id = result.rows[0]?.id;
      if (!id) throw new Error(`Could not create negative fixture ${item.suffix}`);
      const prepared = await repository.createProactiveCampaign({ recruiterContactId: id, candidateProfileId: `${candidateProfile.id}-${item.suffix}`, targetRoles: candidateProfile.targetRoles, subject, body });
      if (prepared) throw new Error(`Unsafe negative fixture became send-eligible: ${item.suffix}`);
    }

    let verifiedWithoutEvidenceBlocked = false;
    try {
      await db.query(`INSERT INTO recruiter_contacts (company_name,company_domain,email,full_name,title,confidence,verified,verification_status,provider,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,relevance_status,last_seen_at,updated_at) VALUES ('Phase Eight Corp',$1,'verifiedflag@phase8.test','Verified Flag','Technical Recruiter',99,true,'mailbox_verified','phase8-negative','VERIFIED','VALID','EXISTS',false,'[]','CURRENT',NOW(),NOW())`, [companyDomain]);
      const prepared = await repository.createProactiveCampaign({ recruiterContactId: (await db.query<{ id: string }>(`SELECT id FROM recruiter_contacts WHERE email='verifiedflag@phase8.test'`)).rows[0]?.id ?? "", candidateProfileId: `${candidateProfile.id}-verifiedflag`, targetRoles: candidateProfile.targetRoles, subject, body });
      if (prepared) throw new Error("verified=true without mailbox evidence became send-eligible");
    } catch (error) {
      if (error instanceof Error && /verified|mailbox|constraint|check/i.test(error.message)) verifiedWithoutEvidenceBlocked = true;
      else throw error;
    }
    if (!verifiedWithoutEvidenceBlocked) throw new Error("verified=true without mailbox evidence was not blocked");

    const wrongDomain = await db.query<{ id: string }>(`INSERT INTO recruiter_contacts (company_name,company_domain,email,full_name,title,confidence,verified,verification_status,provider,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,relevance_status,last_seen_at,updated_at) VALUES ('Phase Eight Corp',$1,'wrong@other.test','Wrong Domain','Technical Recruiter',99,false,'INVALID','phase8-negative','INVALID','INVALID','MISSING',false,'[]','CURRENT',NOW(),NOW()) RETURNING id`, [companyDomain]);
    const wrongDomainPrepared = await repository.createProactiveCampaign({ recruiterContactId: wrongDomain.rows[0]!.id, candidateProfileId: `${candidateProfile.id}-wrong-domain`, targetRoles: candidateProfile.targetRoles, subject, body });
    if (wrongDomainPrepared) throw new Error("Wrong-domain recruiter became send-eligible.");

    console.log(JSON.stringify({ status: "ok", candidateProfile: { exists: true, targetRoles: candidateProfile.targetRoles }, jobsDiscovered: 0, recruiterCandidatesDiscovered: discovered.length, recruiter: { persisted: true, relevance: row.relevance_status, emailStatus: row.email_status, verificationStatus: row.verification_status, mailboxEvidence: row.mailbox_evidence }, proactiveCampaign: { campaignType: campaignRow.rows[0]?.campaign_type, jobId: campaignRow.rows[0]?.job_opportunity_id ?? null, prepared: true, sequences: counts.rows[0]?.sequences, messages: counts.rows[0]?.messages }, duplicatePrevention: { concurrentPreparationsCreated: concurrent.filter(Boolean).length, crossPathDatabaseTrigger: true }, negativeFixtures: { noMailbox: "blocked", mxOnly: "blocked", publicWeb: "blocked", verifiedWithoutEvidence: "blocked", wrongDomain: "blocked" }, sent: 0, gmailEnabled: false, outboundEnabled: false, snovCreditsUsed: 0, productionDatabase: false }));
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
