import pino from "pino";
import { loadConfig } from "./config/env";
import { OllamaProvider } from "./ai/OllamaProvider";
import { JobMatcher } from "./ai/JobMatcher";
import { Database } from "./database/Database";
import { MigrationRunner } from "./database/MigrationRunner";

const config = loadConfig();

const logger = pino({
  level: config.logLevel
});

async function main(): Promise<void> {
  const database = new Database(config.databaseUrl);
  const migrationRunner = new MigrationRunner(database);
  await migrationRunner.run();

  const ollama = new OllamaProvider(
    config.ollama.baseUrl,
    config.ollama.model,
    config.ollama.timeoutMs
  );

  const matcher = new JobMatcher(ollama);

  logger.info(
    {
      nodeEnv: config.nodeEnv,
      ollamaModel: config.ollama.model,
      ollamaBaseUrl: config.ollama.baseUrl
    },
    "job-agent started"
  );

  const result = await matcher.evaluate(
    "Frontend Engineer with React, Next.js, TypeScript, Redux Toolkit, Node.js and 3 years of experience.",
    "We are looking for a Frontend Developer with React and TypeScript experience."
  );

  logger.info({ result }, "AI job-match test completed");

  await database.close();
}

main().catch((error: unknown) => {
  logger.error({ error }, "job-agent failed to start");
  process.exitCode = 1;
});
