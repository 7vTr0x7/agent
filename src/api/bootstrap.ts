import { loadConfig } from "../config/env";
import { Database } from "../database/Database";
import { JobAgentApiServer } from "./JobAgentApiServer";

const config = loadConfig();
const database = new Database(config.databaseUrl);
const server = new JobAgentApiServer(database);

void server.start().catch((error: unknown) => {
  // Keep the worker process authoritative. A dashboard bind failure must not
  // prevent discovery/application automation from running.
  console.error("Job Agent API failed to start:", error instanceof Error ? error.message : String(error));
});

const stop = (): void => {
  void server.stop().finally(() => { void database.close(); });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
