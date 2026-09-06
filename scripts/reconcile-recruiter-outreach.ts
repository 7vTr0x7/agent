import "dotenv/config";
import { Database } from "../src/database/Database";
import { loadConfig } from "../src/config/env";
import { GmailApiMailbox } from "../src/email/GmailApiMailbox";
import { GmailOAuthClient } from "../src/email/GmailOAuthClient";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterOutreachSendReconciliationService } from "../src/recruiters/RecruiterOutreachSendReconciliationService";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.gmail.clientId || !config.gmail.clientSecret || !config.gmail.refreshToken || !config.gmail.userEmail) {
    throw new Error("Gmail OAuth configuration is required for recruiter outreach reconciliation.");
  }

  const database = new Database(config.databaseUrl);
  try {
    const oauth = new GmailOAuthClient({
      clientId: config.gmail.clientId,
      clientSecret: config.gmail.clientSecret,
      refreshToken: config.gmail.refreshToken
    });
    const mailbox = new GmailApiMailbox({ oauth, userEmail: config.gmail.userEmail });
    const repository = new RecruiterDiscoveryRepository(database);
    const service = new RecruiterOutreachSendReconciliationService(database, repository, mailbox);
    console.log(JSON.stringify(await service.runOnce(), null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
