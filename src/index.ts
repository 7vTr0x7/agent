import "dotenv/config";
import { buildApplicationConfig } from "./config/env";
import { createLogger } from "./logging/logger";
import { Database } from "./db/Database";
import { TaskQueue } from "./tasks/TaskQueue";
import { ApplicationTaskDispatcher } from "./applications/ApplicationTaskDispatcher";
import { ApplicationTaskHandler } from "./applications/ApplicationTaskHandler";
import { ApplicationRepository } from "./applications/ApplicationRepository";
import { RecruiterDiscoveryRepository } from "./recruiters/RecruiterDiscoveryRepository";
import { PersistentRecruiterDiscoveryService } from "./recruiters/PersistentRecruiterDiscoveryService";
import { createRecruiterDiscoveryProvider } from "./recruiters/createRecruiterDiscoveryProvider";
import { RecruiterDiscoveryTaskDispatcher } from "./recruiters/RecruiterDiscoveryTaskDispatcher";
import { RecruiterDiscoveryTaskHandler } from "./recruiters/RecruiterDiscoveryTaskHandler";
import { RecruiterOutreachPreparationTaskDispatcher } from "./recruiters/RecruiterOutreachPreparationTaskDispatcher";
import { RecruiterOutreachPreparationTaskHandler } from "./recruiters/RecruiterOutreachPreparationTaskHandler";
import { RecruiterOutreachPreparationService } from "./recruiters/RecruiterOutreachPreparationService";
import { RecruiterOutreachSendTaskDispatcher } from "./recruiters/RecruiterOutreachSendTaskDispatcher";
import { RecruiterOutreachSendTaskHandler } from "./recruiters/RecruiterOutreachSendTaskHandler";
import { RecruiterOutreachSendService } from "./recruiters/RecruiterOutreachSendService";
import { RecruiterOutreachFollowUpService } from "./recruiters/RecruiterOutreachFollowUpService";
import { RecruiterOutreachFollowUpScheduler } from "./recruiters/RecruiterOutreachFollowUpScheduler";
import { RecruiterOutreachSendReconciliationService } from "./recruiters/RecruiterOutreachSendReconciliationService";
import { RecruiterOutreachRuntimeScheduler } from "./recruiters/RecruiterOutreachRuntimeScheduler";
import { GmailApiMailbox } from "./email/GmailApiMailbox";
import { GmailOAuthClient } from "./email/GmailOAuthClient";
import { CandidateProfileResolver } from "./candidates/CandidateProfileResolver";
import { ConfiguredCandidateProfileResolver } from "./candidates/ConfiguredCandidateProfileResolver";
import { JobDiscoveryService } from "./discovery/JobDiscoveryService";
import { JobSourceRepository } from "./discovery/JobSourceRepository";
import { createJobDiscoverySources } from "./discovery/createJobDiscoverySources";
import { DiscoveryTaskDispatcher } from "./discovery/DiscoveryTaskDispatcher";
import { DiscoveryTaskHandler } from "./discovery/DiscoveryTaskHandler";
import { DiscoveryScheduler } from "./discovery/DiscoveryScheduler";
import { ApplicationQueueScheduler } from "./applications/ApplicationQueueScheduler";
import { StaleSubmissionReconciliationService } from "./applications/StaleSubmissionReconciliationService";
import { StaleSubmissionScheduler } from "./applications/StaleSubmissionScheduler";
import { InterviewReminderService } from "./applications/InterviewReminderService";
import { InterviewReminderScheduler } from "./applications/InterviewReminderScheduler";

const config = buildApplicationConfig();
const logger = createLogger(config.logLevel);
const database = new Database(config.databaseUrl);
const taskQueue = new TaskQueue(database);

const applicationRepository = new ApplicationRepository(database);
const candidateProfileResolver: CandidateProfileResolver = new ConfiguredCandidateProfileResolver();
let gmailMailbox: GmailApiMailbox | undefined;
if (config.gmail.enabled) {
  const oauth = new GmailOAuthClient({
    clientId: config.gmail.clientId,
    clientSecret: config.gmail.clientSecret,
    redirectUri: config.gmail.redirectUri,
    refreshToken: config.gmail.refreshToken
  });
  gmailMailbox = new GmailApiMailbox({ oauth, userEmail: config.gmail.userEmail });
}

const applicationDispatcher = new ApplicationTaskDispatcher(taskQueue);
const applicationHandler = new ApplicationTaskHandler({
  repository: applicationRepository,
  candidateProfileResolver,
  dispatcher: applicationDispatcher,
  gmailMailbox,
  logger
});
void applicationHandler;

let recruiterDiscoveryDispatcher: RecruiterDiscoveryTaskDispatcher | undefined;
let recruiterDiscoveryHandler: RecruiterDiscoveryTaskHandler | undefined;
let recruiterPreparationDispatcher: RecruiterOutreachPreparationTaskDispatcher | undefined;
let recruiterPreparationHandler: RecruiterOutreachPreparationTaskHandler | undefined;
let recruiterSendDispatcher: RecruiterOutreachSendTaskDispatcher | undefined;
let recruiterSendHandler: RecruiterOutreachSendTaskHandler | undefined;
let recruiterFollowUpScheduler: RecruiterOutreachFollowUpScheduler | undefined;
let recruiterReconciliationService: RecruiterOutreachSendReconciliationService | undefined;
let recruiterRuntimeScheduler: RecruiterOutreachRuntimeScheduler | undefined;
let recruiterRepository: RecruiterDiscoveryRepository | undefined;
if (config.recruiterOutreach.enabled) {
  const provider = createRecruiterDiscoveryProvider({ provider: config.recruiterOutreach.discoveryProvider });
  recruiterRepository = new RecruiterDiscoveryRepository(database);
  const discovery = new PersistentRecruiterDiscoveryService({ provider, repository: recruiterRepository, minConfidence: config.recruiterOutreach.minConfidence, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail });
  recruiterPreparationDispatcher = new RecruiterOutreachPreparationTaskDispatcher(taskQueue);
  recruiterSendDispatcher = new RecruiterOutreachSendTaskDispatcher(taskQueue);
  const recruiterFollowUpService = new RecruiterOutreachFollowUpService(recruiterRepository, { enabled: config.recruiterOutreach.followUpEnabled, dayOffsets: config.recruiterOutreach.followUpDayOffsets });
  recruiterPreparationHandler = new RecruiterOutreachPreparationTaskHandler(new RecruiterOutreachPreparationService({ repository: recruiterRepository, minConfidence: config.recruiterOutreach.minConfidence, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail, dryRun: config.recruiterOutreach.dryRun }), recruiterSendDispatcher, logger);
  recruiterSendHandler = new RecruiterOutreachSendTaskHandler(new RecruiterOutreachSendService({ repository: recruiterRepository, mailbox: gmailMailbox, dryRun: config.recruiterOutreach.dryRun, outboundEnabled: config.outboundEnabled, activation: config.recruiterOutreach.activation, liveActivationConfirmed: config.recruiterOutreach.liveActivationConfirmed, maxMessagesPerDay: config.recruiterOutreach.maxMessagesPerDay, maxMessagesPerHour: config.recruiterOutreach.maxMessagesPerHour }), recruiterRepository, logger, recruiterFollowUpService);
  if (config.recruiterOutreach.followUpEnabled) recruiterFollowUpScheduler = new RecruiterOutreachFollowUpScheduler(recruiterRepository, recruiterSendDispatcher, true);
  if (gmailMailbox) recruiterReconciliationService = new RecruiterOutreachSendReconciliationService(database, recruiterRepository, gmailMailbox);
  recruiterRuntimeScheduler = new RecruiterOutreachRuntimeScheduler(recruiterFollowUpScheduler, recruiterReconciliationService, logger);
  recruiterDiscoveryDispatcher = new RecruiterDiscoveryTaskDispatcher(taskQueue);
  recruiterDiscoveryHandler = new RecruiterDiscoveryTaskHandler(discovery, config.recruiterOutreach.maxContactsPerApplication, recruiterPreparationDispatcher, logger);
}
void recruiterDiscoveryHandler;
void recruiterPreparationHandler;
void recruiterSendHandler;
void recruiterRuntimeScheduler;
void recruiterDiscoveryDispatcher;

const staleSubmissionService = new StaleSubmissionReconciliationService(applicationRepository);
const staleSubmissionScheduler = new StaleSubmissionScheduler(staleSubmissionService, config.staleSubmissionCheckIntervalMs, config.staleSubmissionThresholdMinutes);
const applicationQueueScheduler = new ApplicationQueueScheduler(applicationHandler, config.applicationQueueIntervalMs);
const interviewReminderScheduler = new InterviewReminderScheduler(new InterviewReminderService(applicationRepository), config.interviewReminderIntervalMs);
void staleSubmissionScheduler;
void applicationQueueScheduler;
void interviewReminderScheduler;

const jobSourceRepository = new JobSourceRepository(database);
const jobDiscoveryService = new JobDiscoveryService({
  repository: jobSourceRepository,
  sources: createJobDiscoverySources(config.discovery),
  logger
});
const discoveryDispatcher = new DiscoveryTaskDispatcher(taskQueue);
const discoveryHandler = new DiscoveryTaskHandler(jobDiscoveryService, logger);
const discoveryScheduler = new DiscoveryScheduler(discoveryDispatcher, config.discoveryIntervalMs);
void discoveryHandler;
void discoveryScheduler;

logger.info("Job agent runtime initialized", {
  automationEnabled: config.automationEnabled,
  applicationDryRun: config.applicationDryRun,
  discoveryEnabled: config.discoveryEnabled,
  gmailEnabled: config.gmail.enabled,
  recruiterEnabled: config.recruiterOutreach.enabled,
  recruiterDiscoveryProvider: config.recruiterOutreach.discoveryProvider,
  recruiterFollowUpEnabled: config.recruiterOutreach.followUpEnabled,
  recruiterFollowUpDayOffsets: config.recruiterOutreach.followUpDayOffsets
});
