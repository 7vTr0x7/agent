import { loadConfig } from "../config/env";
import { Database } from "../database/Database";
import { RecruiterAwareJobAgentApiServer } from "./RecruiterAwareJobAgentApiServer";

const config = loadConfig();
const database = new Database(config.databaseUrl);
const server = new RecruiterAwareJobAgentApiServer(database);

void server.start().catch((error: unknown) => {
  console.error("Job Agent API failed to start:", error instanceof Error ? error.message : String(error));
});

const stop = (): void => {
  void server.stop().finally(() => { void database.close(); });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
