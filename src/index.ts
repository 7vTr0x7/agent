import pino from "pino";
import { loadConfig } from "./config/env";
import { OllamaProvider } from "./ai/OllamaProvider";
import { JobMatcher } from "./ai/JobMatcher";
import { Database } from "./database/Database";
import { MigrationRunner } from "./database/MigrationRunner";
import { TaskQueue } from "./queue/TaskQueue";
import { TaskWorker } from "./queue/TaskWorker";
import { ApplicationRepository } from "./applications/ApplicationRepository";
import { ApplicationQueueService } from "./applications/ApplicationQueueService";
import { ApplicationTaskDispatcher } from "./applications/ApplicationTask";
import { ApplicationTaskHandler } from "./applications/ApplicationTaskHandler";
import { ApplicationAdapterRegistry } from "./applications/ApplicationAdapter";
import { GenericApplicationAdapter } from "./applications/GenericApplicationAdapter";
import { BrowserSessionService } from "./applications/BrowserSession";
import { ApplicationSubmissionService } from "./applications/ApplicationSubmissionService";
import { ConfiguredCandidateProfileResolver } from "./candidates/ConfiguredCandidateProfileResolver";
import { ResendEmailSender } from "./notifications/ResendEmailSender";
import { EmailNotificationService } from "./notifications/EmailNotificationService";
import { EmailNotificationTaskDispatcher } from "./notifications/EmailNotificationTask";
import { EmailNotificationTaskHandler } from "./notifications/EmailNotificationTaskHandler";
import { APPLY_JOB_TASK } from "./applications/ApplicationTask";
import { SEND_APPLICATION_EMAIL_TASK } from "./notifications/EmailNotificationTask";
import { ResumeProfileLoader } from "./resume/ResumeProfileLoader";
import { ResumeTailoringService } from "./resume/ResumeTailoringService";
import { ResumeArtifactRenderer } from "./resume/ResumeArtifactRenderer";
import { TailoredResumeArtifactService } from "./resume/TailoredResumeArtifactService";
import { PostgresTailoredResumeRepository } from "./resume/TailoredResumeRepository";

const config = loadConfig();

const logger = pino({
  level: config.logLevel
});

function csvEnvironment(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

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
      automationEnabled: config.automationEnabled,
      resumeTailoringEnabled: config.resume.tailoringEnabled,
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

  if (!config.automationEnabled) {
    logger.info("Application automation is disabled; no application worker will be started.");
    await database.close();
    return;
  }

  const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
  const candidateProfile = await candidateProfiles.getById(
    process.env.CANDIDATE_PROFILE_ID ?? ""
  );

  if (!candidateProfile) {
    throw new Error("Configured candidate profile could not be resolved.");
  }

  const excludedCompanies = csvEnvironment("JOB_EXCLUDED_COMPANIES");
  const taskQueue = new TaskQueue(database);
  const applicationRepository = new ApplicationRepository(database, excludedCompanies);
  const browserSessions = new BrowserSessionService();
  const adapters = new ApplicationAdapterRegistry([
    new GenericApplicationAdapter()
  ]);
  const submissionService = new ApplicationSubmissionService(
    browserSessions,
    adapters,
    applicationRepository
  );

  let emailDispatcher: EmailNotificationTaskDispatcher | undefined;
  let emailHandler: EmailNotificationTaskHandler | undefined;

  if (config.email.enabled && config.email.apiKey && config.email.from) {
    const sender = new ResendEmailSender({
      apiKey: config.email.apiKey,
      from: config.email.from
    });
    const notifications = new EmailNotificationService(sender);
    emailDispatcher = new EmailNotificationTaskDispatcher(taskQueue);
    emailHandler = new EmailNotificationTaskHandler(notifications);
  }

  let tailoredResumeArtifacts: TailoredResumeArtifactService | undefined;
  let tailoredResumeRepository: PostgresTailoredResumeRepository | undefined;
  if (config.resume.tailoringEnabled && config.resume.masterPath) {
    tailoredResumeArtifacts = new TailoredResumeArtifactService(
      new ResumeProfileLoader(),
      new ResumeTailoringService(),
      new ResumeArtifactRenderer({ outputDirectory: config.resume.outputDirectory }),
      config.resume.masterPath
    );
    tailoredResumeRepository = new PostgresTailoredResumeRepository(database);
  }

  const applicationTaskHandler = new ApplicationTaskHandler(
    applicationRepository,
    submissionService,
    candidateProfiles,
    excludedCompanies,
    emailDispatcher,
    tailoredResumeArtifacts,
    tailoredResumeRepository
  );

  const handlers = new Map<string, any>([
    [APPLY_JOB_TASK, applicationTaskHandler]
  ]);

  if (emailHandler) {
    handlers.set(SEND_APPLICATION_EMAIL_TASK, emailHandler);
  }

  const worker = new TaskWorker(taskQueue, handlers);
  const applicationQueue = new ApplicationQueueService(
    database,
    new ApplicationTaskDispatcher(taskQueue)
  );

  const enqueueLoop = async (): Promise<void> => {
    while (true) {
      const queued = await applicationQueue.enqueueEligible(candidateProfile.id);
      if (queued.queued > 0) {
        logger.info({ queued: queued.queued }, "Eligible application tasks queued");
      }
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  };

  process.once("SIGINT", () => worker.stop());
  process.once("SIGTERM", () => worker.stop());

  await Promise.all([
    worker.run(),
    enqueueLoop()
  ]);

  await database.close();
}

main().catch((error: unknown) => {
  logger.error({ error }, "job-agent failed to start");
  process.exitCode = 1;
});
