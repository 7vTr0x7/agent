import "dotenv/config";

import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { GmailApiMailbox } from "../src/email/GmailApiMailbox";
import { GmailOAuthClient } from "../src/email/GmailOAuthClient";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterOutreachGmailReconciliation } from "../src/recruiters/RecruiterOutreachGmailReconciliation";

async function main(): Promise<void> {
  const messageId = process.env.RECRUITER_CONTROLLED_MESSAGE_ID?.trim();
  if (!messageId) throw new Error("RECRUITER_CONTROLLED_MESSAGE_ID is required.");
  const config = loadConfig();
  if (!config.gmail.enabled || !config.gmail.clientId || !config.gmail.clientSecret || !config.gmail.refreshToken || !config.gmail.userEmail) {
    throw new Error("Gmail credentials are incomplete or Gmail is disabled.");
  }
  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();
    const oauth = new GmailOAuthClient({ clientId: config.gmail.clientId, clientSecret: config.gmail.clientSecret, refreshToken: config.gmail.refreshToken });
    const mailbox = new GmailApiMailbox({ oauth, userEmail: config.gmail.userEmail });
    const repository = new RecruiterDiscoveryRepository(database);
    const result = await new RecruiterOutreachGmailReconciliation(database, mailbox, repository).reconcile(messageId);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "INCONCLUSIVE") process.exitCode = 2;
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
