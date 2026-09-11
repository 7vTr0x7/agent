import "dotenv/config";

import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { GmailApiMailbox } from "../src/email/GmailApiMailbox";
import { GmailOAuthClient } from "../src/email/GmailOAuthClient";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterOutreachSendService } from "../src/recruiters/RecruiterOutreachSendService";
import { CONTROLLED_SEND_CONFIRMATION } from "../src/recruiters/RecruiterOutreachActivationGate";

function fail(message: string): never {
  throw new Error(`Phase 6 controlled Gmail runtime failed: ${message}`);
}

async function verifyAccount(oauth: GmailOAuthClient, expectedEmail: string): Promise<void> {
  const accessToken = await oauth.getAccessToken();
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) fail(`Gmail profile verification returned HTTP ${response.status}.`);
  const profile = (await response.json()) as { emailAddress?: string };
  const actual = profile.emailAddress?.trim().toLowerCase();
  if (!actual) fail("Gmail profile returned no account identity.");
  if (actual !== expectedEmail.toLowerCase()) fail(`Gmail account mismatch: configured=${expectedEmail.toLowerCase()} authorized=${actual}.`);
  console.log(JSON.stringify({ phase: "gmail-account", account: actual, scope: "gmail.send + gmail.readonly", verified: true }));
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.automationEnabled) fail("AUTOMATION_ENABLED must remain false.");
  if (config.applicationDryRun !== true) fail("APPLICATION_DRY_RUN must remain true.");
  if (config.proactiveRecruiter.enabled || config.proactiveRecruiter.sendEnabled) fail("proactive recruiter automation must remain disabled.");
  if (!config.gmail.enabled || !config.outboundEnabled) fail("Gmail and outbound must be explicitly enabled for this controlled runtime only.");
  if (!config.recruiterOutreach.enabled || config.recruiterOutreach.dryRun) fail("recruiter outreach must be explicitly enabled with dry-run disabled.");
  if (config.recruiterOutreach.activation !== "canary") fail("controlled Phase 6 runtime requires RECRUITER_OUTREACH_ACTIVATION=canary.");
  if (config.recruiterOutreach.maxMessagesPerDay !== 1 || config.recruiterOutreach.maxMessagesPerHour !== 1) fail("canary limits must be exactly 1/day and 1/hour.");
  if (config.recruiterOutreach.followUpEnabled) console.log(JSON.stringify({ phase: "follow-up", status: "OFF_FOR_PHASE6", configured: true, note: "Phase 6 does not enqueue or send follow-ups." }));
  if (process.env.RECRUITER_CONTROLLED_SEND_CONFIRM !== CONTROLLED_SEND_CONFIRMATION) fail(`RECRUITER_CONTROLLED_SEND_CONFIRM must equal ${CONTROLLED_SEND_CONFIRMATION}.`);

  const messageId = process.env.RECRUITER_CONTROLLED_MESSAGE_ID?.trim();
  const recipient = process.env.RECRUITER_CONTROLLED_RECIPIENT?.trim().toLowerCase();
  if (!messageId) fail("RECRUITER_CONTROLLED_MESSAGE_ID is required; broad selection is forbidden.");
  if (!recipient) fail("RECRUITER_CONTROLLED_RECIPIENT is required; broad recipient selection is forbidden.");
  if (!config.gmail.userEmail || !config.gmail.clientId || !config.gmail.clientSecret || !config.gmail.refreshToken) fail("Gmail credentials are incomplete.");

  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();
    const repository = new RecruiterDiscoveryRepository(database);
    const before = await database.query<any>(
      `SELECT m.id,m.sequence_id,m.message_type,m.sequence_step,m.recipient_email,m.subject,m.body,m.status,m.send_state,
              s.status AS sequence_status,s.recruiter_contact_id,s.job_opportunity_id,s.candidate_profile_id,
              c.email AS recruiter_email,c.verified AS recruiter_verified,c.verification_status,c.company_name,c.company_domain
         FROM recruiter_outreach_messages m
         JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id
         JOIN recruiter_contacts c ON c.id=s.recruiter_contact_id
        WHERE m.id=$1`,
      [messageId]
    );
    const row = before.rows[0];
    if (!row) fail(`controlled outreach message ${messageId} does not exist.`);
    if (row.status !== "PREPARED") fail(`controlled outreach must start PREPARED; got ${row.status}.`);
    if (String(row.recipient_email).toLowerCase() !== recipient) fail("controlled recipient does not match persisted outreach recipient.");
    if (String(row.recruiter_email).toLowerCase() !== recipient) fail("persisted outreach recipient does not match the associated recruiter contact.");
    if (!row.recruiter_verified) fail(`recipient ${recipient} is not mailbox-VERIFIED; Phase 6 will not weaken the Phase 5 verification rule.`);
    if (!row.job_opportunity_id) fail("controlled outreach must remain associated with a real job opportunity.");
    if (row.sequence_status !== "READY" && row.sequence_status !== "ACTIVE") fail(`sequence is not sendable: ${row.sequence_status}.`);
    const suppression = await repository.isSuppressed(recipient, row.company_domain);
    if (suppression.email || suppression.domain) fail(suppression.email ? "recipient is suppressed." : "company domain is suppressed.");

    const oauth = new GmailOAuthClient({ clientId: config.gmail.clientId, clientSecret: config.gmail.clientSecret, refreshToken: config.gmail.refreshToken });
    await verifyAccount(oauth, config.gmail.userEmail);
    const mailbox = new GmailApiMailbox({ oauth, userEmail: config.gmail.userEmail });
    const service = new RecruiterOutreachSendService({
      repository,
      database,
      mailbox,
      dryRun: false,
      outboundEnabled: config.outboundEnabled,
      gmailEnabled: config.gmail.enabled,
      automationEnabled: config.automationEnabled,
      activation: config.recruiterOutreach.activation,
      liveActivationConfirmed: config.recruiterOutreach.liveActivationConfirmed,
      controlledSendConfirmation: process.env.RECRUITER_CONTROLLED_SEND_CONFIRM,
      controlledMessageId: messageId,
      controlledRecipient: recipient,
      requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail,
      maxMessagesPerDay: 1,
      maxMessagesPerHour: 1
    });

    console.log(JSON.stringify({ phase: "pre-send", messageId, recipient, subject: row.subject, company: row.company_name, jobOpportunityId: row.job_opportunity_id, candidateProfileId: row.candidate_profile_id, activation: "canary", outboundEnabled: true, gmailEnabled: true, automationEnabled: false, applicationDryRun: true }));
    const sent = await service.send(row, row.company_domain);
    if (sent.status !== "SENT") fail(`controlled send did not return SENT: ${sent.status}${"reason" in sent ? ` (${sent.reason})` : ""}`);
    console.log(JSON.stringify({ phase: "gmail-accepted", status: "PASS", messageId: sent.messageId, gmailMessageId: sent.gmailMessageId, gmailThreadId: sent.gmailThreadId }));

    const verified = await mailbox.getMessage(sent.gmailMessageId);
    if (verified.gmailMessageId !== sent.gmailMessageId) fail("Gmail verification returned a different message ID.");
    if (verified.gmailThreadId !== sent.gmailThreadId) fail("Gmail verification returned a different thread ID.");
    if (verified.recipientEmail?.toLowerCase().includes(recipient) !== true) fail("Gmail verification recipient does not match controlled recipient.");
    if (verified.subject !== row.subject) fail("Gmail verification subject does not match persisted outreach.");
    const expectedRfc = `<recruiter-outreach-${messageId}@job-agent.local>`;
    if (verified.rfcMessageId !== expectedRfc) fail("Gmail verification did not preserve the deterministic RFC Message-ID.");

    const persisted = await database.query<any>(
      `SELECT m.status,m.send_state,m.provider,m.provider_message_id,m.provider_thread_id,m.recipient_email,m.subject,
              s.recruiter_contact_id,s.job_opportunity_id,s.candidate_profile_id
         FROM recruiter_outreach_messages m
         JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id
        WHERE m.id=$1`,
      [messageId]
    );
    const sentRow = persisted.rows[0];
    if (!sentRow || sentRow.status !== "SENT" || sentRow.send_state !== "SENT") fail("database state does not agree with Gmail acceptance.");
    if (sentRow.provider_message_id !== sent.gmailMessageId || sentRow.provider_thread_id !== sent.gmailThreadId) fail("provider identifiers were not persisted exactly.");

    const exactBefore = await mailbox.listMessages(`rfc822msgid:${expectedRfc}`, 20);
    if (exactBefore.length !== 1) fail(`expected exactly one Gmail message with the deterministic RFC Message-ID; found ${exactBefore.length}.`);

    const reloaded = await repository.getOutreachMessage(messageId);
    if (!reloaded) fail("sent outreach disappeared from the database.");
    const replay = await service.send(reloaded, row.company_domain);
    if (replay.status !== "SKIPPED") fail(`reprocessing SENT outreach unexpectedly returned ${replay.status}.`);
    const exactAfter = await mailbox.listMessages(`rfc822msgid:${expectedRfc}`, 20);
    if (exactAfter.length !== 1) fail(`duplicate-send protection failed: deterministic RFC Message-ID count is ${exactAfter.length}.`);

    console.log(JSON.stringify({
      phase: 6,
      acceptance: {
        preparedOutreach: "PASS",
        explicitActivation: "PASS",
        eligibility: "PASS",
        atomicClaim: "PASS",
        gmailSend: "PASS",
        gmailEvidence: "PASS",
        databaseSentState: "PASS",
        messageId: sent.gmailMessageId,
        threadId: sent.gmailThreadId,
        reprocessSameOutreach: replay.status,
        additionalGmailMessagesAfterReprocess: exactAfter.length - exactBefore.length,
        duplicateProtection: "PASS"
      },
      safety: {
        bulkSending: false,
        automaticFollowUp: false,
        applicationsSubmitted: false,
        proactiveRecruiterSend: false,
        automationEnabled: config.automationEnabled,
        applicationDryRun: config.applicationDryRun
      }
    }, null, 2));
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
