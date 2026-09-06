import pino from "pino";
import { loadConfig } from "./config/env";
import { OllamaProvider } from "./ai/OllamaProvider";
import { JobMatcher } from "./ai/JobMatcher";
import { Database } from "./database/Database";
import { MigrationRunner } from "./database/MigrationRunner";
import { TaskQueue } from "./queue/TaskQueue";
import { TaskWorker } from "./queue/TaskWorker";
import { ApplicationRepository } from "./applications/ApplicationRepository";
import { ApplicationAttemptRepository } from "./applications/ApplicationAttemptRepository";
import { ApplicationQueueService } from "./applications/ApplicationQueueService";
import { ApplicationRateLimitPolicy } from "./applications/ApplicationRateLimitPolicy";
import { ApplicationCompanyRateLimitPolicy } from "./applications/ApplicationCompanyRateLimitPolicy";
import { ApplicationTaskDispatcher } from "./applications/ApplicationTask";
import { ApplicationTaskHandler } from "./applications/ApplicationTaskHandler";
import { ApplicationAdapterRegistry } from "./applications/ApplicationAdapter";
import { GenericApplicationAdapter } from "./applications/GenericApplicationAdapter";
import { createHostedAtsApplicationAdapters } from "./applications/AtsApplicationAdapters";
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
import { GmailOAuthClient } from "./email/GmailOAuthClient";
import { GmailApiMailbox } from "./email/GmailApiMailbox";
import { GmailMessageRepository } from "./email/GmailMessageRepository";
import { GmailSyncTaskDispatcher, GmailSyncTaskHandler, SYNC_GMAIL_TASK } from "./email/GmailSyncTask";
import { InterviewRepository } from "./email/InterviewRepository";
import { InterviewReminderScheduler } from "./email/InterviewReminderScheduler";
import { InterviewReminderTaskDispatcher, SEND_INTERVIEW_REMINDER_TASK } from "./email/InterviewReminderTask";
import { InterviewReminderTaskHandler } from "./email/InterviewReminderTaskHandler";
import { FollowUpDraftRepository } from "./applications/FollowUpDraftRepository";
import { FollowUpScheduler } from "./applications/FollowUpScheduler";
import { FollowUpTaskDispatcher, PREPARE_FOLLOW_UP_TASK } from "./applications/FollowUpTask";
import { FollowUpTaskHandler } from "./applications/FollowUpTaskHandler";
import { createDiscoveryRuntime } from "./discovery/createDiscoveryRuntime";
import { MATCH_JOB_TASK } from "./matching/MatchTask";

const config = loadConfig();
const logger = pino({ level: config.logLevel });

function csvEnvironment(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const database = new Database(config.databaseUrl);
  const migrationRunner = new MigrationRunner(database);
  await migrationRunner.run();

  const matcher = new JobMatcher(
    new OllamaProvider(config.ollama.baseUrl, config.ollama.model, config.ollama.timeoutMs)
  );

  logger.info(
    {
      nodeEnv: config.nodeEnv,
      automationEnabled: config.automationEnabled,
      discoveryEnabled: config.discoveryEnabled,
      discoveryIntervalMs: config.discoveryIntervalMs,
      configuredJobSources: config.jobSources ? "configured" : "none",
      resumeTailoringEnabled: config.resume.tailoringEnabled,
      gmailEnabled: config.gmail.enabled,
      genericApplicationAdapterEnabled: config.genericApplicationAdapterEnabled,
      applicationRateLimitPerDay: config.applicationRateLimitPerDay,
      applicationCompanyRateLimitPerDay: config.applicationCompanyRateLimitPerDay,
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

  const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
  const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

  const taskQueue = new TaskQueue(database);

  if (!config.automationEnabled) {
    if (!config.discoveryEnabled) {
      logger.info("Application automation and job discovery are disabled; exiting.");
      await database.close();
      return;
    }

    const discoveryRuntime = createDiscoveryRuntime(database, taskQueue, config, candidateProfile);
    logger.info({ sourceCount: discoveryRuntime.sourceCount }, "Discovery runtime started");

    const discoveryWorker = new TaskWorker(
      taskQueue,
      new Map<string, any>([[MATCH_JOB_TASK, discoveryRuntime.matchTaskHandler]])
    );

    const discoveryLoop = async (): Promise<void> => {
      while (true) {
        const results = await discoveryRuntime.runner.runOnce();
        for (const result of results) {
          logger.info(
            { source: result.source, discovered: result.discovered, matching: result.matching },
            "Discovery source run completed"
          );
        }
        await new Promise((resolve) => setTimeout(resolve, config.discoveryIntervalMs));
      }
    };

    process.once("SIGINT", () => discoveryWorker.stop());
    process.once("SIGTERM", () => discoveryWorker.stop());

    await Promise.all([discoveryWorker.run(), discoveryLoop()]);
    await database.close();
    return;
  }

  const excludedCompanies = csvEnvironment("JOB_EXCLUDED_COMPANIES");
  const applicationRepository = new ApplicationRepository(database, excludedCompanies);
  const applicationAttemptRepository = new ApplicationAttemptRepository(database);
  const browserSessions = new BrowserSessionService();
  const hostedAtsAdapters = createHostedAtsApplicationAdapters();
  const adapters = config.genericApplicationAdapterEnabled
    ? [...hostedAtsAdapters, new GenericApplicationAdapter()]
    : hostedAtsAdapters;
  const adaptersRegistry = new ApplicationAdapterRegistry(adapters);
  const submissionService = new ApplicationSubmissionService(browserSessions, adaptersRegistry, applicationRepository);

  let emailDispatcher: EmailNotificationTaskDispatcher | undefined;
  let emailHandler: EmailNotificationTaskHandler | undefined;
  let emailNotifications: EmailNotificationService | undefined;
  if (config.email.enabled && config.email.apiKey && config.email.from) {
    const sender = new ResendEmailSender({ apiKey: config.email.apiKey, from: config.email.from });
    emailNotifications = new EmailNotificationService(sender);
    emailDispatcher = new EmailNotificationTaskDispatcher(taskQueue);
    emailHandler = new EmailNotificationTaskHandler(emailNotifications);
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
    tailoredResumeRepository,
    applicationAttemptRepository
  );

  const handlers = new Map<string, any>([[APPLY_JOB_TASK, applicationTaskHandler]]);
  if (emailHandler) handlers.set(SEND_APPLICATION_EMAIL_TASK, emailHandler);

  let discoveryRuntime: ReturnType<typeof createDiscoveryRuntime> | undefined;
  if (config.discoveryEnabled) {
    discoveryRuntime = createDiscoveryRuntime(database, taskQueue, config, candidateProfile);
    handlers.set(MATCH_JOB_TASK, discoveryRuntime.matchTaskHandler);
    logger.info({ sourceCount: discoveryRuntime.sourceCount }, "Discovery runtime enabled");
  }

  let gmailSyncDispatcher: GmailSyncTaskDispatcher | undefined;
  let interviewRepository: InterviewRepository | undefined;
  if (config.gmail.enabled && config.gmail.clientId && config.gmail.clientSecret && config.gmail.refreshToken && config.gmail.userEmail) {
    const mailbox = new GmailApiMailbox({
      oauth: new GmailOAuthClient({
        clientId: config.gmail.clientId,
        clientSecret: config.gmail.clientSecret,
        refreshToken: config.gmail.refreshToken
      }),
      userEmail: config.gmail.userEmail
    });
    interviewRepository = new InterviewRepository(database);
    handlers.set(
      SYNC_GMAIL_TASK,
      new GmailSyncTaskHandler(
        mailbox,
        new GmailMessageRepository(database),
        interviewRepository
      )
    );
    gmailSyncDispatcher = new GmailSyncTaskDispatcher(taskQueue);
  }

  let followUpScheduler: FollowUpScheduler | undefined;
  if (config.gmail.enabled) {
    const followUpDrafts = new FollowUpDraftRepository(database);
    handlers.set(PREPARE_FOLLOW_UP_TASK, new FollowUpTaskHandler(followUpDrafts));
    followUpScheduler = new FollowUpScheduler(
      followUpDrafts,
      new FollowUpTaskDispatcher(taskQueue)
    );
  }

  let interviewReminderScheduler: InterviewReminderScheduler | undefined;
  if (interviewRepository && emailNotifications && candidateProfile.email) {
    handlers.set(
      SEND_INTERVIEW_REMINDER_TASK,
      new InterviewReminderTaskHandler(emailNotifications, interviewRepository)
    );
    interviewReminderScheduler = new InterviewReminderScheduler(
      interviewRepository,
      new InterviewReminderTaskDispatcher(taskQueue),
      candidateProfile.email,
      candidateProfile.fullName ?? ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || "Candidate")
    );
  }

  const worker = new TaskWorker(taskQueue, handlers);
  const applicationQueue = new ApplicationQueueService(
    database,
    new ApplicationTaskDispatcher(taskQueue),
    new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: config.applicationRateLimitPerDay }),
    new ApplicationCompanyRateLimitPolicy({
      maxSubmissionsPerCompanyPerDay: config.applicationCompanyRateLimitPerDay
    })
  );

  const enqueueApplicationsLoop = async (): Promise<void> => {
    while (true) {
      const queued = await applicationQueue.enqueueEligible(candidateProfile.id);
      if (queued.queued > 0) logger.info(queued, "Eligible application tasks queued");
      if (queued.rateLimited) logger.warn(queued, "Daily application submission limit reached");
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  };

  const discoveryLoop = async (): Promise<void> => {
    if (!discoveryRuntime) return;
    while (true) {
      const results = await discoveryRuntime.runner.runOnce();
      for (const result of results) {
        logger.info(
          { source: result.source, discovered: result.discovered, matching: result.matching },
          "Discovery source run completed"
        );
      }
      await new Promise((resolve) => setTimeout(resolve, config.discoveryIntervalMs));
    }
  };

  const syncGmailLoop = async (): Promise<void> => {
    if (!gmailSyncDispatcher) return;
    while (true) {
      await gmailSyncDispatcher.enqueue(config.gmail.syncQuery, 50);
      await new Promise((resolve) => setTimeout(resolve, config.gmail.syncIntervalMs));
    }
  };

  const followUpLoop = async (): Promise<void> => {
    if (!followUpScheduler) return;
    while (true) {
      const result = await followUpScheduler.runOnce();
      if (result.queued > 0) logger.info(result, "Follow-up drafts queued");
      await new Promise((resolve) => setTimeout(resolve, 300_000));
    }
  };

  const interviewReminderLoop = async (): Promise<void> => {
    if (!interviewReminderScheduler) return;
    while (true) {
      const result = await interviewReminderScheduler.runOnce();
      if (result.queued > 0) logger.info(result, "Interview reminders queued");
      await new Promise((resolve) => setTimeout(resolve, 300_000));
    }
  };

  process.once("SIGINT", () => worker.stop());
  process.once("SIGTERM", () => worker.stop());

  await Promise.all([
    worker.run(),
    enqueueApplicationsLoop(),
    discoveryLoop(),
    syncGmailLoop(),
    followUpLoop(),
    interviewReminderLoop()
  ]);
  await database.close();
}

main().catch((error: unknown) => {
  logger.error({ error }, "job-agent failed to start");
  process.exitCode = 1;
});
