import "dotenv/config";

import { Database } from "../src/database/Database";
import { GmailOAuthClient } from "../src/email/GmailOAuthClient";
import { GmailApiMailbox } from "../src/email/GmailApiMailbox";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterOutreachSendService } from "../src/recruiters/RecruiterOutreachSendService";
import { GlobalExternalSideEffectGate } from "../src/shared/safety/GlobalExternalSideEffectGate";
import { CONTROLLED_SEND_CONFIRMATION } from "../src/recruiters/RecruiterOutreachActivationGate";

const APPROVAL = "SEND_ONE_REAL_RECRUITER_EMAIL";

async function main(): Promise<void> {
  const approval = process.env.PHASE10_LIVE_TEST_APPROVAL?.trim();
  const messageId = process.env.PHASE10_LIVE_TEST_MESSAGE_ID?.trim();
  const recipient = process.env.PHASE10_LIVE_TEST_RECIPIENT?.trim().toLowerCase();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  const userEmail = process.env.GMAIL_USER_EMAIL?.trim().toLowerCase();

  if (approval !== APPROVAL) throw new Error(`Refusing live recruiter test. Set PHASE10_LIVE_TEST_APPROVAL=${APPROVAL} only after explicitly approving one bounded real recruiter email.`);
  if (!messageId || !recipient) throw new Error("PHASE10_LIVE_TEST_MESSAGE_ID and PHASE10_LIVE_TEST_RECIPIENT are required.");
  if (process.env.RECRUITER_OUTREACH_DRY_RUN !== "false") throw new Error("RECRUITER_OUTREACH_DRY_RUN must be false for the controlled live test.");
  if (process.env.RECRUITER_OUTREACH_ACTIVATION !== "canary") throw new Error("RECRUITER_OUTREACH_ACTIVATION must be canary for the controlled live test.");
  if (process.env.RECRUITER_CONTROLLED_SEND_CONFIRM !== CONTROLLED_SEND_CONFIRMATION) throw new Error("RECRUITER_CONTROLLED_SEND_CONFIRM is missing the required explicit confirmation.");
  if (process.env.RECRUITER_CONTROLLED_MESSAGE_ID?.trim() !== messageId) throw new Error("RECRUITER_CONTROLLED_MESSAGE_ID must exactly equal PHASE10_LIVE_TEST_MESSAGE_ID.");
  if (process.env.RECRUITER_CONTROLLED_RECIPIENT?.trim().toLowerCase() !== recipient) throw new Error("RECRUITER_CONTROLLED_RECIPIENT must exactly equal PHASE10_LIVE_TEST_RECIPIENT.");
  if (process.env.RECRUITER_MAX_MESSAGES_PER_DAY !== "1" || process.env.RECRUITER_MAX_MESSAGES_PER_HOUR !== "1") throw new Error("Controlled recruiter canary requires exactly one message/day and one message/hour.");
  if (process.env.GMAIL_ENABLED !== "true" || process.env.OUTBOUND_ENABLED !== "true") throw new Error("GMAIL_ENABLED=true and OUTBOUND_ENABLED=true are required for the controlled live test.");
  if (!databaseUrl || !clientId || !clientSecret || !refreshToken || !userEmail) throw new Error("Database and Gmail OAuth configuration are required for the controlled live test.");

  const database = new Database(databaseUrl);
  try {
    const migrations = await database.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1");
    if (migrations.rows[0]?.name !== "038_phase10_activation_safety.sql") throw new Error("Phase 10 activation migration is not applied.");
    const safety = new GlobalExternalSideEffectGate(database);
    const gate = await safety.evaluate();
    if (!gate.allowed) throw new Error(`Global emergency stop blocks live test: ${gate.reason}`);

    const repository = new RecruiterDiscoveryRepository(database);
    const message = await repository.getOutreachMessage(messageId);
    if (!message) throw new Error("Selected recruiter outreach message does not exist.");
    if (message.recipientEmail.toLowerCase() !== recipient) throw new Error("Selected message recipient does not match the explicitly approved recipient.");

    const oauth = new GmailOAuthClient({ clientId, clientSecret, refreshToken });
    const mailbox = new GmailApiMailbox({ oauth, userEmail });
    const service = new RecruiterOutreachSendService({
      repository, database, mailbox, dryRun: false, outboundEnabled: true, gmailEnabled: true, automationEnabled: false,
      activation: "canary", liveActivationConfirmed: false,
      controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: messageId, controlledRecipient: recipient,
      requireVerifiedEmail: true, maxMessagesPerDay: 1, maxMessagesPerHour: 1,
      resumePath: process.env.CANDIDATE_RESUME_PATH?.trim() || null, attachResume: process.env.RECRUITER_ATTACH_RESUME !== "false",
      maxAttachmentBytes: Number(process.env.RECRUITER_MAX_ATTACHMENT_BYTES ?? 10 * 1024 * 1024), externalSideEffectGate: safety
    });
    const domain = recipient.split("@")[1] ?? "";
    console.log(JSON.stringify({ phase: "phase10-live-test", messageId, recipient, mode: "ONE_REAL_RECRUITER_EMAIL", approval: "explicit", noApplicationSubmission: true }));
    const result = await service.send(message, domain);
    console.log(JSON.stringify({ phase: "phase10-live-test-result", status: result.status, messageId: result.messageId, ...(result.status === "SENT" ? { gmailMessageId: result.gmailMessageId, gmailThreadId: result.gmailThreadId } : { reason: result.reason }) }));
    if (result.status !== "SENT") throw new Error(`Controlled live recruiter test did not send: ${result.reason}`);
  } finally { await database.close(); }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
