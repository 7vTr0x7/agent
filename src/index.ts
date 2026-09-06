import "dotenv/config";
import { Database } from "./database/Database";
import { MigrationRunner } from "./database/MigrationRunner";
import { loadConfig } from "./config";
import { createLogger } from "./logging/logger";
import { ApplicationQueueService } from "./applications/ApplicationQueueService";
import { ApplicationTaskDispatcher, APPLY_JOB_TASK } from "./applications/ApplicationTask";
import { ApplicationSubmissionService } from "./applications/ApplicationSubmissionService";
import { ApplicationAdapterRegistry } from "./applications/ApplicationAdapter";
import { GenericApplicationAdapter } from "./applications/GenericApplicationAdapter";
import { ApplicationRepository } from "./applications/ApplicationRepository";
import { BrowserSessionService } from "./browser/BrowserSession";
import { TaskQueue } from "./queue/TaskQueue";
import { TaskWorker } from "./queue/TaskWorker";
import { EmailNotificationService } from "./notifications/EmailNotificationService";
import { EmailNotificationTaskHandler } from "./notifications/EmailNotificationTaskHandler";
import { EmailNotificationTaskDispatcher, SEND_APPLICATION_EMAIL_TASK } from "./notifications/EmailNotificationTask";
import { ResendEmailSender } from "./notifications/ResendEmailSender";
import { GmailApiMailbox } from "./email/GmailApiMailbox";
import { GmailMessageRepository } from "./email/GmailMessageRepository";
import { GmailOAuthClient } from "./email/GmailOAuthClient";
import { GmailSyncTaskHandler, GMAIL_SYNC_TASK } from "./email/GmailSyncTask";
import { GmailSyncTaskDispatcher } from "./email/GmailSyncTask";
import { InterviewRepository } from "./email/InterviewRepository";
import { InterviewReminderScheduler } from "./email/InterviewReminderScheduler";
import { InterviewReminderTaskDispatcher, SEND_INTERVIEW_REMINDER_TASK } from "./email/InterviewReminderTask";
import { InterviewReminderTaskHandler } from "./email/InterviewReminderTaskHandler";
import { FollowUpDraftRepository } from "./applications/FollowUpDraftRepository";
import { FollowUpScheduler } from "./applications/FollowUpScheduler";
import { FollowUpTaskDispatcher, SEND_FOLLOW_UP_DRAFT_TASK } from "./applications/FollowUpTask";
import { FollowUpTaskHandler } from "./applications/FollowUpTaskHandler";
import { CandidateProfileLoader } from "./jobs/CandidateProfileLoader";
import { CandidateProfile } from "./jobs/domain/CandidateProfile";
import { config } from "./config";

const logger = createLogger();

async function main(): Promise<void> {
  const appConfig = loadConfig();
  const database = new Database(appConfig.databaseUrl);
  const migrationRunner = new MigrationRunner(database);
  await migrationRunner.run();

  const taskQueue = new TaskQueue(database);
  const applicationRepository = new ApplicationRepository(database);
  const candidateProfile = new CandidateProfileLoader(appConfig.candidateProfilePath).load();

  const browserSessions = new BrowserSessionService({
    headless: appConfig.browserHeadless,
    storageStatePath: appConfig.browserStorageStatePath,
    navigationTimeoutMs: appConfig.browserNavigationTimeoutMs
  });

  const applicationAdapters = new ApplicationAdapterRegistry(
    appConfig.genericApplicationAdapterEnabled ? [new GenericApplicationAdapter()] : []
  );
  const submissionService = new ApplicationSubmissionService(
    browserSessions,
    applicationAdapters,
    applicationRepository
  );

  const handlers = new Map<string, any>();
  const emailNotifications = appConfig.emailEnabled && appConfig.resendApiKey && appConfig.emailFrom
    ? new EmailNotificationService(new ResendEmailSender(appConfig.resendApiKey, appConfig.emailFrom))
    : undefined;

  if (emailNotifications) {
    handlers.set(
      SEND_APPLICATION_EMAIL_TASK,
      new EmailNotificationTaskHandler(emailNotifications)
    );
  }

  const interviewRepository = appConfig.gmailEnabled
    ? new InterviewRepository(database)
    : undefined;

  if (appConfig.gmailEnabled) {
    const oauth = new GmailOAuthClient({
      clientId: appConfig.gmailClientId,
      clientSecret: appConfig.gmailClientSecret,
      refreshToken: appConfig.gmailRefreshToken
    });
    const mailbox = new GmailApiMailbox(oauth);
    const gmailMessages = new GmailMessageRepository(database);
    handlers.set(
      GMAIL_SYNC_TASK,
      new GmailSyncTaskHandler(mailbox, gmailMessages, interviewRepository)
    );
  }

  const followUpDrafts = new FollowUpDraftRepository(database);
  if (appConfig.gmailEnabled && candidateProfile.email) {
    handlers.set(
      SEND_FOLLOW_UP_DRAFT_TASK,
      new FollowUpTaskHandler(followUpDrafts)
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
  const applicationQueue = new ApplicationQueueService(database, new ApplicationTaskDispatcher(taskQueue));

  const enqueueApplicationsLoop = async (): Promise<void> => {
    while (true) {
      const queued = await applicationQueue.enqueueEligible(candidateProfile.id);
      if (queued.queued > 0) logger.info({ queued: queued.queued }, "Eligible application tasks queued");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  };

  const processApplicationTask = async (task: any): Promise<void> => {
    if (task.taskType !== APPLY_JOB_TASK) {
      throw new Error(`Unsupported application task type: ${task.taskType}`);
    }

    const prepared = await applicationRepository.prepare(task.payload.jobOpportunityId, task.payload.candidateProfileId);
    if (!prepared) {
      logger.info({ jobOpportunityId: task.payload.jobOpportunityId }, "Application task skipped because job is no longer eligible");
      return;
    }

    const outcome = await submissionService.submit({
      context: {
        jobOpportunityId: prepared.jobOpportunityId,
        candidateProfileId: prepared.candidateProfileId,
        applicationId: prepared.applicationId,
        url: prepared.url
      },
      companyName: prepared.companyName,
      excludedCompanies: appConfig.excludedCompanies,
      candidateProfile
    });

    if (!outcome.submitted) {
      logger.warn(
        { applicationId: prepared.applicationId, reason: outcome.reason },
        "Application task did not submit"
      );
      return;
    }

    if (emailNotifications && candidateProfile.email) {
      const dispatcher = new EmailNotificationTaskDispatcher(taskQueue);
      await dispatcher.enqueueSubmitted({
        recipient: candidateProfile.email,
        candidateName: candidateProfile.fullName ?? "Candidate",
        jobTitle: prepared.jobTitle,
        companyName: prepared.companyName,
        applicationUrl: prepared.url
      });
    }
  };

  handlers.set(APPLY_JOB_TASK, processApplicationTask);

  void worker.run();
  void enqueueApplicationsLoop();

  if (interviewReminderScheduler) {
    const interviewReminderLoop = async (): Promise<void> => {
      while (true) {
        await interviewReminderScheduler.runOnce(new Date());
        await new Promise((resolve) => setTimeout(resolve, 300_000));
      }
    };
    void interviewReminderLoop();
  }
}

void main().catch((error) => {
  logger.error({ err: error }, "job-agent startup failed");
  process.exitCode = 1;
});
