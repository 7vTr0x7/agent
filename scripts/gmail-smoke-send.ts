import "dotenv/config";

import { GmailApiMailbox } from "../src/email/GmailApiMailbox";
import { GmailOAuthClient } from "../src/email/GmailOAuthClient";

const CONFIRMATION = "SEND_TO_SELF";
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15000;

async function main(): Promise<void> {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  const userEmail = process.env.GMAIL_USER_EMAIL?.trim().toLowerCase();
  const confirmation = process.env.GMAIL_SMOKE_SEND_CONFIRM?.trim();

  if (!clientId || !clientSecret || !refreshToken || !userEmail) {
    throw new Error("GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_USER_EMAIL are required.");
  }

  if (confirmation !== CONFIRMATION) {
    throw new Error(`Refusing to send. Set GMAIL_SMOKE_SEND_CONFIRM=${CONFIRMATION} to explicitly authorize a self-send smoke test.`);
  }

  const oauth = new GmailOAuthClient({ clientId, clientSecret, refreshToken });
  const mailbox = new GmailApiMailbox({ oauth, userEmail });
  const marker = `job-agent-gmail-smoke-${Date.now()}`;
  const subject = `[JOB-AGENT GMAIL SMOKE] ${marker}`;
  const body = [
    "This is an automated Gmail delivery smoke test for job-agent.",
    "",
    `Marker: ${marker}`,
    `Sent at: ${new Date().toISOString()}`,
    "",
    "This test sends only to the configured Gmail account itself."
  ].join("\n");

  console.log(JSON.stringify({ phase: "send", to: userEmail, subject, msg: "Sending self-test email" }));
  const sent = await mailbox.sendMessage({
    to: userEmail,
    subject,
    bodyText: body,
    messageId: `<${marker}@job-agent.local>`
  });

  console.log(JSON.stringify({ phase: "sent", ...sent, msg: "Gmail API accepted the message" }));

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ids = await mailbox.listMessages(`to:${userEmail} subject:"${subject.replace(/"/g, "")}" newer_than:1d`, 10);
    for (const id of ids) {
      const received = await mailbox.getMessage(id);
      if (received.subject === subject && received.bodyText.includes(marker)) {
        console.log(JSON.stringify({
          phase: "verified",
          gmailMessageId: received.gmailMessageId,
          gmailThreadId: received.gmailThreadId,
          subject: received.subject,
          recipientEmail: received.recipientEmail,
          msg: "Gmail delivery verified by reading the message back from the mailbox"
        }));
        console.log("GMAIL_SMOKE_TEST=PASS");
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Gmail API accepted the message, but the smoke test could not read it back within ${POLL_TIMEOUT_MS}ms.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("GMAIL_SMOKE_TEST=FAIL");
  process.exitCode = 1;
});
