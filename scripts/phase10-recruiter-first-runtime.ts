import { Database } from "../src/database/Database";
import { GlobalExternalSideEffectGate } from "../src/shared/safety/GlobalExternalSideEffectGate";
import { GmailMailbox } from "../src/email/GmailMailbox";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterOutreachSendService } from "../src/recruiters/RecruiterOutreachSendService";
import { CONTROLLED_SEND_CONFIRMATION, evaluateRecruiterOutreachActivation } from "../src/recruiters/RecruiterOutreachActivationGate";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";

const DB = process.env.DATABASE_URL;
if (!DB) throw new Error("DATABASE_URL is required");

const profileId = "phase10-proactive-candidate";
const companyName = "Phase Ten Example Corp";
const domain = "phase10.example.test";
const email = `recruiter@${domain}`;
const targetRoles = ["React Developer", "Frontend Engineer", "React + Next.js Developer"];
const subject = "React / Next.js opportunities — proactive introduction";
const body = [
  "Hi Recruiter,",
  "",
  "I’m exploring React Developer and Frontend Engineer opportunities and have approximately 3 years of experience with React.js, Next.js and TypeScript.",
  "",
  "I’m reaching out proactively rather than assuming there is a specific opening. If you recruit for roles that fit this background, I’d be happy to share my resume and discuss relevant opportunities.",
  "",
  "Thank you,",
  "Phase Ten Candidate"
].join("\n");

const validEvidence = [{ provider: "phase10-isolated-mailbox-verifier", status: "mailbox_verified", confidence: 99, mailboxLevel: true, source: "isolated-test-provider" }];

async function insertContact(db: Database, values: { suffix: string; email: string; verified: boolean; verificationStatus: string; emailStatus: string; mailboxEvidence: boolean; evidence: unknown[]; relevance?: string; suppressed?: boolean; domain?: string }): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO recruiter_contacts (company_name,company_domain,email,full_name,title,confidence,verified,verification_status,provider,email_status,domain_status,mx_status,mailbox_evidence,verification_evidence,relevance_status,suppressed,last_seen_at,updated_at)
     VALUES ($1,$2,$3,$4,'Technical Recruiter',99,$5,$6,'phase10-fixture',$7,'VALID','EXISTS',$8,$9,$10,$11,NOW(),NOW()) RETURNING id`,
    [companyName, values.domain ?? domain, values.email, `Phase10 ${values.suffix}`, values.verified, values.verificationStatus, values.emailStatus, values.mailboxEvidence, JSON.stringify(values.evidence), values.relevance ?? "CURRENT", values.suppressed ?? false]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Could not create contact fixture ${values.suffix}`);
  return id;
}

async function main(): Promise<void> {
  const db = new Database(DB!);
  try {
    const migration = await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1");
    if (migration.rows[0]?.name !== "038_phase10_activation_safety.sql") throw new Error(`Phase 10 migration is not latest: ${migration.rows[0]?.name ?? "none"}`);
    const jobs = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM job_opportunities WHERE company_domain=$1", [domain]);
    if (jobs.rows[0]?.count !== "0") throw new Error("No-job fixture isolation failed: a job exists for the proactive company.");

    const proactiveRepository = new ProactiveRecruiterRepository(db);
    const recruiterRepository = new RecruiterDiscoveryRepository(db);
    const validContactId = await insertContact(db, { suffix: "Valid", email, verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, evidence: validEvidence });
    const validCampaign = await proactiveRepository.createProactiveCampaign({ recruiterContactId: validContactId, candidateProfileId: profileId, targetRoles, subject, body });
    if (!validCampaign) throw new Error("Valid proactive recruiter campaign was not created without a job.");

    const campaignRow = await db.query<any>("SELECT campaign_type,job_opportunity_id,candidate_profile_id FROM recruiter_outreach_sequences WHERE id=$1", [validCampaign.sequenceId]);
    if (campaignRow.rows[0]?.campaign_type !== "PROACTIVE_RECRUITER" || campaignRow.rows[0]?.job_opportunity_id !== null || campaignRow.rows[0]?.candidate_profile_id !== profileId) throw new Error(`Proactive campaign shape is invalid: ${JSON.stringify(campaignRow.rows[0])}`);

    const duplicates = await Promise.all([
      proactiveRepository.createProactiveCampaign({ recruiterContactId: validContactId, candidateProfileId: profileId, targetRoles, subject, body }),
      proactiveRepository.createProactiveCampaign({ recruiterContactId: validContactId, candidateProfileId: profileId, targetRoles, subject, body })
    ]);
    if (duplicates.some(Boolean)) throw new Error("Concurrent proactive campaign creation created a duplicate.");

    const sequenceCount = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM recruiter_outreach_sequences WHERE recruiter_contact_id=$1 AND candidate_profile_id=$2 AND campaign_type='PROACTIVE_RECRUITER'", [validContactId, profileId]);
    if (sequenceCount.rows[0]?.count !== "1") throw new Error(`Expected one proactive campaign, got ${sequenceCount.rows[0]?.count}`);

    const negatives = [
      { name: "unverified", email: `unverified@${domain}`, verified: false, verificationStatus: "unverified_public_source", emailStatus: "UNVERIFIED", mailboxEvidence: false, evidence: [] },
      { name: "mx-only", email: `mxonly@${domain}`, verified: false, verificationStatus: "domain_mx_verified", emailStatus: "LIKELY", mailboxEvidence: false, evidence: [{ provider: "mx", status: "mx_verified", mailboxLevel: false }] },
      { name: "web-only", email: `webonly@${domain}`, verified: false, verificationStatus: "unverified_public_source", emailStatus: "UNVERIFIED", mailboxEvidence: false, evidence: [{ provider: "web", status: "public-web", mailboxLevel: false }] },
      { name: "wrong-domain", email: "wrong@other.example.test", verified: false, verificationStatus: "INVALID", emailStatus: "INVALID", mailboxEvidence: false, evidence: [], domain },
      { name: "suppressed", email: `suppressed@${domain}`, verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, evidence: validEvidence, suppressed: true },
      { name: "unknown-relevance", email: `unknown@${domain}`, verified: true, verificationStatus: "mailbox_verified", emailStatus: "VERIFIED", mailboxEvidence: true, evidence: validEvidence, relevance: "UNKNOWN" }
    ];
    const blocked: Record<string, boolean> = {};
    for (const item of negatives) {
      const id = await insertContact(db, item);
      const prepared = await proactiveRepository.createProactiveCampaign({ recruiterContactId: id, candidateProfileId: `${profileId}-${item.name}`, targetRoles, subject, body });
      blocked[item.name] = !prepared;
      if (prepared) throw new Error(`Unsafe recruiter ${item.name} became campaign-eligible.`);
    }

    const killSwitch = new GlobalExternalSideEffectGate(db);
    const kill = await killSwitch.evaluate();
    if (kill.allowed) throw new Error("Expected Phase 10 default global emergency stop to be active in isolated validation.");

    const mailboxCalls: string[] = [];
    const mailbox: GmailMailbox = {
      listMessages: async () => [],
      getMessage: async () => { throw new Error("Not implemented in isolated send-block fixture"); },
      sendMessage: async (message) => { mailboxCalls.push(message.to); return { gmailMessageId: "fixture-message", gmailThreadId: "fixture-thread" }; }
    };
    const messageId = (await db.query<{ id: string }>("SELECT id FROM recruiter_outreach_messages WHERE sequence_id=$1 LIMIT 1", [validCampaign.sequenceId])).rows[0]?.id;
    if (!messageId) throw new Error("Valid proactive message was not persisted.");
    const message = await recruiterRepository.getOutreachMessage(messageId);
    if (!message) throw new Error("Valid proactive message could not be loaded.");
    const sendService = new RecruiterOutreachSendService({ repository: recruiterRepository, database: db, mailbox, dryRun: false, outboundEnabled: true, gmailEnabled: true, automationEnabled: false, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: messageId, controlledRecipient: email, requireVerifiedEmail: true, maxMessagesPerDay: 1, maxMessagesPerHour: 1, externalSideEffectGate: killSwitch });
    const blockedSend = await sendService.send(message, domain);
    if (blockedSend.status !== "SKIPPED" || mailboxCalls.length !== 0) throw new Error(`Global kill switch did not block live send: ${JSON.stringify(blockedSend)}`);

    const canaryMissingTarget = evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    if (canaryMissingTarget.allowed) throw new Error("Canary activation allowed an unbound target.");

    const countSent = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM recruiter_outreach_messages WHERE status='SENT'");
    console.log(JSON.stringify({ status: "ok", jobsDiscovered: 0, company: { discovered: true, domain }, recruiter: { discovered: true, identityValidated: true, relevance: "CURRENT" }, proactiveCampaign: { campaignType: campaignRow.rows[0]?.campaign_type, jobId: campaignRow.rows[0]?.job_opportunity_id ?? null, prepared: true, sequenceCount: sequenceCount.rows[0]?.count }, concurrentDuplicates: duplicates.filter(Boolean).length, negatives: blocked, killSwitch: "blocked-live-send", canary: "requires-explicit-target", gmailCalls: mailboxCalls.length, sent: countSent.rows[0]?.count ?? "0", productionDatabase: false, realGmailSend: false, snovCreditsUsed: 0 }));
  } finally { await db.close(); }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
