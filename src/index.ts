import pino from "pino";
import { loadConfig } from "./config/env";
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
import { StaleSubmissionMonitor } from "./applications/StaleSubmissionMonitor";
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
import { runPeriodicLoop } from "./shared/utils/RuntimeLoop";
import { HunterRecruiterDiscoveryProvider } from "./recruiters/HunterRecruiterDiscoveryProvider";
import { RecruiterDiscoveryRepository } from "./recruiters/RecruiterDiscoveryRepository";
import { PersistentRecruiterDiscoveryService } from "./recruiters/PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryTaskDispatcher, DISCOVER_RECRUITERS_TASK } from "./recruiters/RecruiterDiscoveryTask";
import { RecruiterDiscoveryTaskHandler } from "./recruiters/RecruiterDiscoveryTaskHandler";
import { RecruiterOutreachPreparationService } from "./recruiters/RecruiterOutreachPreparationService";
import { RecruiterOutreachPreparationTaskDispatcher, PREPARE_RECRUITER_OUTREACH_TASK } from "./recruiters/RecruiterOutreachPreparationTask";
import { RecruiterOutreachPreparationTaskHandler } from "./recruiters/RecruiterOutreachPreparationTaskHandler";
import { RecruiterOutreachSendService } from "./recruiters/RecruiterOutreachSendService";
import { RecruiterOutreachSendTaskDispatcher, SEND_RECRUITER_EMAIL_TASK } from "./recruiters/RecruiterOutreachSendTask";
import { RecruiterOutreachSendTaskHandler } from "./recruiters/RecruiterOutreachSendTaskHandler";
import { RecruiterOutreachFollowUpService } from "./recruiters/RecruiterOutreachFollowUpService";
import { RecruiterOutreachFollowUpScheduler } from "./recruiters/RecruiterOutreachFollowUpScheduler";
import { RecruiterOutreachInboundProcessor } from "./recruiters/RecruiterOutreachInboundProcessor";

const config = loadConfig();
const logger = pino({ level: config.logLevel });

function csvEnvironment(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function main(): Promise<void> {
  const database = new Database(config.databaseUrl);
  const migrationRunner = new MigrationRunner(database);
  await migrationRunner.run();

  logger.info(
    {
      nodeEnv: config.nodeEnv,
      automationEnabled: config.automationEnabled,
      applicationDryRun: config.applicationDryRun,
      discoveryEnabled: config.discoveryEnabled,
      discoveryIntervalMs: config.discoveryIntervalMs,
      applicationQueueIntervalMs: config.applicationQueueIntervalMs,
      staleSubmissionCheckIntervalMs: config.staleSubmissionCheckIntervalMs,
      staleSubmissionThresholdMinutes: config.staleSubmissionThresholdMinutes,
      followUpIntervalMs: config.followUpIntervalMs,
      interviewReminderIntervalMs: config.interviewReminderIntervalMs,
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

  const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
  const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

  const taskQueue = new TaskQueue(database);
  const shutdownController = new AbortController();
  let shutdownRequested = false;
  let stopWorker: () => void = () => undefined;
  const requestShutdown = (): void => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info("Shutdown requested");
    shutdownController.abort();
    stopWorker();
  };

  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

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
      new Map<string, any>([[MATCH_JOB_TASK, discoveryRuntime.matchTaskHandler]]),
      { logger }
    );
    stopWorker = () => discoveryWorker.stop();

    const discoveryLoop = (): Promise<void> =>
      runPeriodicLoop({
        name: "discovery",
        intervalMs: config.discoveryIntervalMs,
        signal: shutdownController.signal,
        logger,
        sleep,
        runOnce: async () => {
          const results = await discoveryRuntime.runner.runOnce();
          for (const result of results) {
            logger.info(
              { source: result.source, discovered: result.discovered, matching: result.matching },
              "Discovery source run completed"
            );
          }
        }
      });

    await Promise.all([discoveryWorker.run(), discoveryLoop()]);
    await database.close();
    return;
  }

  const excludedCompanies = csvEnvironment("JOB_EXCLUDED_COMPANIES");
  const applicationRepository = new ApplicationRepository(database, excludedCompanies);
  const applicationAttemptRepository = new ApplicationAttemptRepository(database);
  const staleSubmissionMonitor = new StaleSubmissionMonitor(
    applicationRepository,
    logger,
    config.staleSubmissionThresholdMinutes
  );
  const browserSessions = new BrowserSessionService();
  const hostedAtsAdapters = createHostedAtsApplicationAdapters();
  const adapters = config.genericApplicationAdapterEnabled
    ? [...hostedAtsAdapters, new GenericApplicationAdapter()]
    : hostedAtsAdapters;
  const adaptersRegistry = new ApplicationAdapterRegistry(adapters);
  const submissionService = new ApplicationSubmissionService(
    browserSessions,
    adaptersRegistry,
    applicationRepository,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    config.applicationDryRun
  );

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

  let gmailMailbox: GmailApiMailbox | undefined;
  let gmailSyncDispatcher: GmailSyncTaskDispatcher | undefined;
  let interviewRepository: InterviewRepository | undefined;
  if (config.gmail.enabled && config.gmail.clientId && config.gmail.clientSecret && config.gmail.refreshToken && config.gmail.userEmail) {
    gmailMailbox = new GmailApiMailbox({
      oauth: new GmailOAuthClient({
        clientId: config.gmail.clientId,
        clientSecret: config.gmail.clientSecret,
        refreshToken: config.gmail.refreshToken
      }),
      userEmail: config.gmail.userEmail
    });
    interviewRepository = new InterviewRepository(database);
  }

  let recruiterDiscoveryDispatcher: RecruiterDiscoveryTaskDispatcher | undefined;
  let recruiterDiscoveryHandler: RecruiterDiscoveryTaskHandler | undefined;
  let recruiterPreparationDispatcher: RecruiterOutreachPreparationTaskDispatcher | undefined;
  let recruiterPreparationHandler: RecruiterOutreachPreparationTaskHandler | undefined;
  let recruiterSendDispatcher: RecruiterOutreachSendTaskDispatcher | undefined;
  let recruiterSendHandler: RecruiterOutreachSendTaskHandler | undefined;
  let recruiterFollowUpScheduler: RecruiterOutreachFollowUpScheduler | undefined;
  let recruiterRepository: RecruiterDiscoveryRepository | undefined;
  if (config.recruiterOutreach.enabled && config.recruiterOutreach.hunterApiKey) {
    const provider = new HunterRecruiterDiscoveryProvider({ apiKey: config.recruiterOutreach.hunterApiKey });
    recruiterRepository = new RecruiterDiscoveryRepository(database);
    const discovery = new PersistentRecruiterDiscoveryService({
      provider,
      repository: recruiterRepository,
      minConfidence: config.recruiterOutreach.minConfidence,
      requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail
    });
    recruiterPreparationDispatcher = new RecruiterOutreachPreparationTaskDispatcher(taskQueue);
    recruiterSendDispatcher = gmailMailbox ? new RecruiterOutreachSendTaskDispatcher(taskQueue) : undefined;
    const recruiterFollowUpService = new RecruiterOutreachFollowUpService(recruiterRepository, {
      enabled: config.recruiterOutreach.followUpEnabled,
      dayOffsets: config.recruiterOutreach.followUpDayOffsets
    });
    recruiterPreparationHandler = new RecruiterOutreachPreparationTaskHandler(
      new RecruiterOutreachPreparationService({
        repository: recruiterRepository,
        minConfidence: config.recruiterOutreach.minConfidence,
        requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail,
        dryRun: config.recruiterOutreach.dryRun
      }),
      recruiterSendDispatcher,
      logger
    );
    if (recruiterSendDispatcher && gmailMailbox) {
      recruiterSendHandler = new RecruiterOutreachSendTaskHandler(
        new RecruiterOutreachSendService({
          repository: recruiterRepository,
          mailbox: gmailMailbox,
          dryRun: config.recruiterOutreach.dryRun,
          maxMessagesPerDay: config.recruiterOutreach.maxMessagesPerDay,
          maxMessagesPerHour: config.recruiterOutreach.maxMessagesPerHour
        }),
        recruiterRepository,
        logger,
        recruiterFollowUpService
      );
      if (config.recruiterOutreach.followUpEnabled) {
        recruiterFollowUpScheduler = new RecruiterOutreachFollowUpScheduler(
          recruiterRepository,
          recruiterSendDispatcher,
          true
        );
      }
    }
    recruiterDiscoveryDispatcher = new RecruiterDiscoveryTaskDispatcher(taskQueue);
    recruiterDiscoveryHandler = new RecruiterDiscoveryTaskHandler(
      discovery,
      config.recruiterOutreach.maxContactsPerApplication,
      recruiterPreparationDispatcher,
      logger
    );
  }

  const applicationTaskHandler = new ApplicationTaskHandler(
    applicationRepository,
    submissionService,
    candidateProfiles,
    excludedCompanies,
    emailDispatcher,
    tailoredResumeArtifacts,
    tailoredResumeRepository,
    applicationAttemptRepository,
    recruiterDiscoveryDispatcher
  );

  const handlers = new Map<string, any>([[APPLY_JOB_TASK, applicationTaskHandler]]);
  if (emailHandler) handlers.set(SEND_APPLICATION_EMAIL_TASK, emailHandler);
  if (recruiterDiscoveryHandler) handlers.set(DISCOVER_RECRUITERS_TASK, recruiterDiscoveryHandler);
  if (recruiterPreparationHandler) handlers.set(PREPARE_RECRUITER_OUTREACH_TASK, recruiterPreparationHandler);
  if (recruiterSendHandler) handlers.set(SEND_RECRUITER_EMAIL_TASK, recruiterSendHandler);

  let discoveryRuntime: ReturnType<typeof createDiscoveryRuntime> | undefined;
  if (config.discoveryEnabled) {
    discoveryRuntime = createDiscoveryRuntime(database, taskQueue, config, candidateProfile);
    handlers.set(MATCH_JOB_TASK, discoveryRuntime.matchTaskHandler);
    logger.info({ sourceCount: discoveryRuntime.sourceCount }, "Discovery runtime enabled");
  }

  if (gmailMailbox && interviewRepository) {
    handlers.set(
      SYNC_GMAIL_TASK,
      new GmailSyncTaskHandler(
        gmailMailbox,
        new GmailMessageRepository(database),
        interviewRepository,
        undefined,
        undefined,
        recruiterRepository ? new RecruiterOutreachInboundProcessor(recruiterRepository) : undefined
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

  const worker = new TaskWorker(taskQueue, handlers, { logger });
  stopWorker = () => worker.stop();

  const applicationQueueService = new ApplicationQueueService(
    taskQueue,
    applicationRepository,
    new ApplicationRateLimitPolicy(config.applicationRateLimitPerDay),
    new ApplicationCompanyRateLimitPolicy(config.applicationCompanyRateLimitPerDay)
  );

  const applicationLoop = (): Promise<void> =>
    runPeriodicLoop({
      name: "application-queue",
      intervalMs: config.applicationQueueIntervalMs,
      signal: shutdownController.signal,
      logger,
      sleep,
      runOnce: () => applicationQueueService.enqueueEligibleApplications()
    });

  const staleSubmissionLoop = (): Promise<void> =>
    runPeriodicLoop({
      name: "stale-submission-monitor",
      intervalMs: config.staleSubmissionCheckIntervalMs,
      signal: shutdownController.signal,
      logger,
      sleep,
      runOnce: async () => {
        const result = await staleSubmissionMonitor.runOnce(config.staleSubmissionThresholdMinutes);
        if (result.requeued > 0) logger.info(result, "Stale application submissions requeued");
      }
    });

  const discoveryLoop = (): Promise<void> =>
    runPeriodicLoop({
      name: "discovery",
      intervalMs: config.discoveryIntervalMs,
      signal: shutdownController.signal,
      logger,
      sleep,
      runOnce: async () => {
        if (!discoveryRuntime) return;
        const results = await discoveryRuntime.runner.runOnce();
        for (const result of results) {
          logger.info(
            { source: result.source, discovered: result.discovered, matching: result.matching },
            "Discovery source run completed"
          );
        }
      }
    });

  const gmailSyncLoop = (): Promise<void> =>
    runPeriodicLoop({
      name: "gmail-sync",
      intervalMs: config.gmail.syncIntervalMs,
      signal: shutdownController.signal,
      logger,
      sleep,
      runOnce: async () => {
        if (!gmailSyncDispatcher) return;
        await gmailSyncDispatcher.enqueue();
      }
    });

  const followUpLoop = (): Promise<void> =>
    runPeriodicLoop({
      name: "application-follow-up",
      intervalMs: config.followUpIntervalMs,
      signal: shutdownController.signal,
      logger,
      sleep,
      runOnce: async () => {
        if (!followUpScheduler) return;
        const result = await followUpScheduler.runOnce();
        if (result.queued > 0) logger.info(result, "Application follow-ups queued");
      }
    });

  const interviewReminderLoop = (): Promise<void> =>
    runPeriodicLoop({
      name: "interview-reminder",
      intervalMs: config.interviewReminderIntervalMs,
      signal: shutdownController.signal,
      logger,
      sleep,
      runOnce: async () => {
        if (!interviewReminderScheduler) return;
        const result = await interviewReminderScheduler.runOnce();
        if (result.queued > 0) logger.info(result, "Interview reminders queued");
      }
    });

  const recruiterFollowUpLoop = (): Promise<void> =>
    runPeriodicLoop({
      name: "recruiter-follow-up",
      intervalMs: config.followUpIntervalMs,
      signal: shutdownController.signal,
      logger,
      sleep,
      runOnce: async () => {
        if (!recruiterFollowUpScheduler) return;
        const result = await recruiterFollowUpScheduler.runOnce();
        if (result.queued > 0) logger.info(result, "Recruiter follow-up emails queued");
      }
    });

  const loops: Promise<void>[] = [applicationLoop(), staleSubmissionLoop()];
  if (discoveryRuntime) loops.push(discoveryLoop());
  if (gmailSyncDispatcher) loops.push(gmailSyncLoop());
  if (followUpScheduler) loops.push(followUpLoop());
  if (interviewReminderScheduler) loops.push(interviewReminderLoop());
  if (recruiterFollowUpScheduler) loops.push(recruiterFollowUpLoop());

  await Promise.all([worker.run(), ...loops]);
  await database.close();
}

main().catch((error) => {
  logger.error({ err: error }, "job-agent crashed");
  process.exitCode = 1;
});
