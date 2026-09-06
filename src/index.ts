import { config } from "./config";
import { Database } from "./database/Database";
import { MigrationRunner } from "./database/MigrationRunner";
import { ApplicationQueueService } from "./applications/ApplicationQueueService";
import { ApplicationTaskDispatcher, APPLY_JOB_TASK } from "./applications/ApplicationTask";
import { ApplicationQueueWorker } from "./applications/ApplicationQueueWorker";
import { BrowserSessionService } from "./browser/BrowserSession";
import { GenericApplicationAdapter } from "./applications/GenericApplicationAdapter";
import { ApplicationAdapterRegistry } from "./applications/ApplicationAdapter";
import { ApplicationRepository } from "./applications/ApplicationRepository";
import { TaskQueue } from "./queue/TaskQueue";
import { TaskWorker } from "./queue/TaskWorker";
import { EmailNotificationService } from "./notifications/EmailNotificationService";
import { EmailNotificationTaskHandler } from "./notifications/EmailNotificationTaskHandler";
import { SEND_APPLICATION_EMAIL_TASK } from "./notifications/EmailNotificationTask";
import { ResendEmailSender } from "./notifications/ResendEmailSender";
import { GmailApiMailbox } from "./email/GmailApiMailbox";
import { GmailOAuthClient } from "./email/GmailOAuthClient";
import { GmailMessageRepository } from "./email/GmailMessageRepository";
import { GmailSyncTask } from "./email/GmailSyncTask";
import { InterviewRepository } from "./email/InterviewRepository";
import { SEND_INTERVIEW_REMINDER_TASK, InterviewReminderTaskDispatcher } from "./email/InterviewReminderTask";
import { InterviewReminderScheduler } from "./email/InterviewReminderScheduler";
import { InterviewReminderTaskHandler } from "./email/InterviewReminderTaskHandler";
import { FollowUpDraftRepository } from "./applications/FollowUpDraftRepository";
import { FollowUpScheduler } from "./applications/FollowUpScheduler";
import { FollowUpTaskHandler } from "./applications/FollowUpTaskHandler";
import { FOLLOW_UP_TASK } from "./applications/FollowUpTask";

async function main(): Promise<void> {
  const database = new Database(config.databaseUrl);
  const migrations = new MigrationRunner(database);
  await migrations.run();

  const taskQueue = new TaskQueue(database);
  const handlers = new Map<string, any>();

  const candidateProfile = config.candidateProfile;
  const applicationRepository = new ApplicationRepository(database);

  const browserSessions = new BrowserSessionService({
    headless: config.browserHeadless,
    navigationTimeoutMs: config.browserNavigationTimeoutMs,
    storageStatePath: config.browserStorageStatePath
  });

  const applicationAdapters = [
    ...(config.genericApplicationAdapterEnabled ? [new GenericApplicationAdapter()] : [])
  ];
  const adapterRegistry = new ApplicationAdapterRegistry(applicationAdapters);

  const applicationQueue = new ApplicationQueueService(
    database,
    new ApplicationTaskDispatcher(taskQueue)
  );

  const applicationWorker = new ApplicationQueueWorker(
    taskQueue,
    applicationRepository,
    browserSessions,
    adapterRegistry,
    candidateProfile,
    config.excludedCompanies
  );

  handlers.set(APPLY_JOB_TASK, applicationWorker);

  let emailNotifications: EmailNotificationService | undefined;
  if (config.emailEnabled && config.resendApiKey && config.emailFrom && candidateProfile.email) {
    emailNotifications = new EmailNotificationService(
      new ResendEmailSender(config.resendApiKey, config.emailFrom),
      candidateProfile.email
    );
    handlers.set(
      SEND_APPLICATION_EMAIL_TASK,
      new EmailNotificationTaskHandler(emailNotifications)
    );
  }

  let interviewRepository: InterviewRepository | undefined;
  if (
    config.gmailClientId &&
    config.gmailClientSecret &&
    config.gmailRefreshToken
  ) {
    const gmailOAuth = new GmailOAuthClient(
      config.gmailClientId,
      config.gmailClientSecret,
      config.gmailRefreshToken
    );
    const gmailMailbox = new GmailApiMailbox(gmailOAuth);
    const gmailMessages = new GmailMessageRepository(database);
    interviewRepository = new InterviewRepository(database);
    handlers.set(
      "SYNC_GMAIL",
      new GmailSyncTask(gmailMailbox, gmailMessages, interviewRepository)
    );
  }

  if (interviewRepository && emailNotifications && candidateProfile.email) {
    handlers.set(
      SEND_INTERVIEW_REMINDER_TASK,
      new InterviewReminderTaskHandler(emailNotifications, interviewRepository)
    );
    const candidateName =
      candidateProfile.fullName ??
      ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || "Candidate");
    const interviewReminderScheduler = new InterviewReminderScheduler(
      interviewRepository,
      new InterviewReminderTaskDispatcher(taskQueue),
      candidateProfile.email,
      candidateName
    );
    void interviewReminderScheduler;
  }

  const followUpDraftRepository = new FollowUpDraftRepository(database);
  if (config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken && candidateProfile.email) {
    handlers.set(FOLLOW_UP_TASK, new FollowUpTaskHandler(followUpDraftRepository));
  }

  const worker = new TaskWorker(taskQueue, handlers);
  await worker.start();
  await applicationQueue.enqueueEligibleApplications(candidateProfile.id, 50);
}

void main();
