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
import { GlobalExternalSideEffectGate } from "./shared/safety/GlobalExternalSideEffectGate";
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
import { RecruiterOutreachSendReconciliationService } from "./recruiters/RecruiterOutreachSendReconciliationService";
import { RecruiterOutreachRuntimeScheduler } from "./recruiters/RecruiterOutreachRuntimeScheduler";
import { RecruiterOutreachInboundProcessor } from "./recruiters/RecruiterOutreachInboundProcessor";
import { createRecruiterDiscoveryProvider } from "./recruiters/createRecruiterDiscoveryProvider";
import { ProactiveRecruiterDiscoveryService } from "./recruiters/ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "./recruiters/ProactiveRecruiterRepository";
import { ProactiveRecruiterTaskHandler } from "./recruiters/ProactiveRecruiterTaskHandler";
import { ProactiveRecruiterTaskDispatcher, PROACTIVE_RECRUITER_DISCOVERY_TASK, PROACTIVE_RECRUITER_OUTREACH_TASK } from "./recruiters/ProactiveRecruiterTask";
import { createProactiveRecruiterRuntime } from "./recruiters/createProactiveRecruiterRuntime";

const config = loadConfig();
const logger = pino({ level: config.logLevel });

function csvEnvironment(name: string): string[] { return (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean); }
function sleep(ms: number, signal: AbortSignal): Promise<void> { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms); const onAbort = (): void => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve(); }; signal.addEventListener("abort", onAbort, { once: true }); }); }

async function main(): Promise<void> {
  const database = new Database(config.databaseUrl);
  const migrationRunner = new MigrationRunner(database);
  await migrationRunner.run();
  const externalSideEffectGate = new GlobalExternalSideEffectGate(database);
  logger.info({ nodeEnv: config.nodeEnv, automationEnabled: config.automationEnabled, applicationDryRun: config.applicationDryRun, applicationLiveEnabled: config.applicationLiveEnabled, discoveryEnabled: config.discoveryEnabled, discoveryIntervalMs: config.discoveryIntervalMs, applicationQueueIntervalMs: config.applicationQueueIntervalMs, staleSubmissionCheckIntervalMs: config.staleSubmissionCheckIntervalMs, staleSubmissionThresholdMinutes: config.staleSubmissionThresholdMinutes, followUpIntervalMs: config.followUpIntervalMs, interviewReminderIntervalMs: config.interviewReminderIntervalMs, configuredJobSources: config.jobSources ? "configured" : "none", resumeTailoringEnabled: config.resume.tailoringEnabled, gmailEnabled: config.gmail.enabled, gmailAccountTier: config.gmail.accountTier, gmailDailySendLimit: config.gmail.dailySendLimit, genericApplicationAdapterEnabled: config.genericApplicationAdapterEnabled, applicationRateLimitPerDay: config.applicationRateLimitPerDay, applicationCompanyRateLimitPerDay: config.applicationCompanyRateLimitPerDay, ollamaModel: config.ollama.model, ollamaBaseUrl: config.ollama.baseUrl, recruiterActivation: config.recruiterOutreach.activation, recruiterFollowUpEnabled: config.recruiterOutreach.followUpEnabled, recruiterFollowUpDayOffsets: config.recruiterOutreach.followUpDayOffsets, proactiveRecruiterEnabled: config.proactiveRecruiter.enabled, proactiveRecruiterSendEnabled: config.proactiveRecruiter.sendEnabled }, "job-agent started");
  const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
  const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");
  const taskQueue = new TaskQueue(database);
  const shutdownController = new AbortController();
  let stopWorker: () => void = () => undefined;
  const requestShutdown = (): void => { logger.info("Shutdown requested"); shutdownController.abort(); stopWorker(); };
  process.once("SIGINT", requestShutdown); process.once("SIGTERM", requestShutdown);

  let gmailMailbox: GmailApiMailbox | undefined;
  if (config.gmail.enabled && config.gmail.clientId && config.gmail.clientSecret && config.gmail.refreshToken && config.gmail.userEmail) gmailMailbox = new GmailApiMailbox({ oauth: new GmailOAuthClient({ clientId: config.gmail.clientId, clientSecret: config.gmail.clientSecret, refreshToken: config.gmail.refreshToken }), userEmail: config.gmail.userEmail });

  if (!config.automationEnabled) {
    let discoveryRuntime: ReturnType<typeof createDiscoveryRuntime> | undefined;
    const proactiveRuntime = config.proactiveRecruiter.enabled ? createProactiveRecruiterRuntime(database, taskQueue, config, gmailMailbox, logger) : undefined;
    if (!config.discoveryEnabled && !proactiveRuntime) { logger.info("Application automation, job discovery, and proactive recruiter discovery are disabled; exiting."); await database.close(); return; }
    if (config.discoveryEnabled) { discoveryRuntime = createDiscoveryRuntime(database, taskQueue, config, candidateProfile); logger.info({ sourceCount: discoveryRuntime.sourceCount }, "Discovery runtime started"); }
    const handlers = new Map<string, any>();
    if (discoveryRuntime) handlers.set(MATCH_JOB_TASK, discoveryRuntime.matchTaskHandler);
    if (proactiveRuntime) { handlers.set(PROACTIVE_RECRUITER_DISCOVERY_TASK, proactiveRuntime.handler); handlers.set(PROACTIVE_RECRUITER_OUTREACH_TASK, proactiveRuntime.handler); handlers.set(SEND_RECRUITER_EMAIL_TASK, proactiveRuntime.sendHandler); }
    const discoveryWorker = new TaskWorker(taskQueue, handlers, { logger });
    stopWorker = () => discoveryWorker.stop();
    const discoveryLoop = (): Promise<void> => runPeriodicLoop({ name: "discovery", intervalMs: config.discoveryIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!discoveryRuntime) return; const results = await discoveryRuntime.runner.runOnce(); const backfill = await discoveryRuntime.matchQueueService.enqueueUnmatched(candidateProfile.id); for (const result of results) logger.info({ source: result.source, discovered: result.discovered, matching: result.matching }, "Discovery source run completed"); if (backfill.queued > 0) logger.info({ queued: backfill.queued }, "Stale/unmatched opportunities queued for matching"); } });
    const proactiveRecruiterLoop = (): Promise<void> => runPeriodicLoop({ name: "proactive-recruiter-discovery", intervalMs: config.proactiveRecruiter.intervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!proactiveRuntime) return; await proactiveRuntime.dispatcher.enqueueDiscovery({ candidateProfileId: candidateProfile.id, candidateName: candidateProfile.fullName ?? ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || undefined), yearsExperience: candidateProfile.yearsExperience, skills: [...candidateProfile.skills], targetRoles: [...candidateProfile.targetTitles], location: candidateProfile.location, preferredLocations: csvEnvironment("CANDIDATE_PREFERRED_LOCATIONS"), remoteEligible: booleanEnvironment("CANDIDATE_REMOTE_ELIGIBLE", true), maxCandidates: config.proactiveRecruiter.maxCandidatesPerRun }); } });
    const loops: Array<Promise<void>> = []; if (discoveryRuntime) loops.push(discoveryLoop()); if (proactiveRuntime) loops.push(proactiveRecruiterLoop());
    await Promise.all([discoveryWorker.run(), ...loops]); await database.close(); return;
  }

  const excludedCompanies = csvEnvironment("JOB_EXCLUDED_COMPANIES");
  const applicationRepository = new ApplicationRepository(database, excludedCompanies);
  const applicationAttemptRepository = new ApplicationAttemptRepository(database);
  const staleSubmissionMonitor = new StaleSubmissionMonitor(applicationRepository, logger, config.staleSubmissionThresholdMinutes);
  const browserSessions = new BrowserSessionService();
  const hostedAtsAdapters = createHostedAtsApplicationAdapters();
  const adapters = config.genericApplicationAdapterEnabled ? [...hostedAtsAdapters, new GenericApplicationAdapter()] : hostedAtsAdapters;
  const adaptersRegistry = new ApplicationAdapterRegistry(adapters);
  const submissionService = new ApplicationSubmissionService(browserSessions, adaptersRegistry, applicationRepository, undefined, undefined, undefined, undefined, undefined, undefined, config.applicationDryRun, undefined, undefined, undefined, config.applicationLiveEnabled, externalSideEffectGate);

  let emailDispatcher: EmailNotificationTaskDispatcher | undefined;
  let emailHandler: EmailNotificationTaskHandler | undefined;
  let emailNotifications: EmailNotificationService | undefined;
  if (config.email.enabled && config.email.apiKey && config.email.from) { const sender = new ResendEmailSender({ apiKey: config.email.apiKey, from: config.email.from }); emailNotifications = new EmailNotificationService(sender); emailDispatcher = new EmailNotificationTaskDispatcher(taskQueue); emailHandler = new EmailNotificationTaskHandler(emailNotifications); }
  let tailoredResumeArtifacts: TailoredResumeArtifactService | undefined;
  let tailoredResumeRepository: PostgresTailoredResumeRepository | undefined;
  if (config.resume.tailoringEnabled && config.resume.masterPath) { tailoredResumeArtifacts = new TailoredResumeArtifactService(new ResumeProfileLoader(), new ResumeTailoringService(), new ResumeArtifactRenderer({ outputDirectory: config.resume.outputDirectory }), config.resume.masterPath); tailoredResumeRepository = new PostgresTailoredResumeRepository(database); }
  let gmailSyncDispatcher: GmailSyncTaskDispatcher | undefined;
  let interviewRepository: InterviewRepository | undefined;
  if (gmailMailbox) interviewRepository = new InterviewRepository(database);

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
  let proactiveRecruiterDispatcher: ProactiveRecruiterTaskDispatcher | undefined;
  let proactiveRecruiterHandler: ProactiveRecruiterTaskHandler | undefined;
  if (config.recruiterOutreach.enabled) {
    const provider = createRecruiterDiscoveryProvider({ provider: config.recruiterOutreach.discoveryProvider }); recruiterRepository = new RecruiterDiscoveryRepository(database);
    const discovery = new PersistentRecruiterDiscoveryService({ provider, repository: recruiterRepository, minConfidence: config.recruiterOutreach.minConfidence, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail });
    recruiterPreparationDispatcher = new RecruiterOutreachPreparationTaskDispatcher(taskQueue); recruiterSendDispatcher = new RecruiterOutreachSendTaskDispatcher(taskQueue);
    const recruiterFollowUpService = new RecruiterOutreachFollowUpService(recruiterRepository, { enabled: config.recruiterOutreach.followUpEnabled, dayOffsets: config.recruiterOutreach.followUpDayOffsets });
    recruiterPreparationHandler = new RecruiterOutreachPreparationTaskHandler(new RecruiterOutreachPreparationService({ repository: recruiterRepository, minConfidence: config.recruiterOutreach.minConfidence, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail, dryRun: config.recruiterOutreach.dryRun }), recruiterSendDispatcher, logger);
    recruiterSendHandler = new RecruiterOutreachSendTaskHandler(new RecruiterOutreachSendService({ repository: recruiterRepository, database, mailbox: gmailMailbox, dryRun: config.recruiterOutreach.dryRun, outboundEnabled: config.outboundEnabled, gmailEnabled: config.gmail.enabled, automationEnabled: config.automationEnabled, activation: config.recruiterOutreach.activation, liveActivationConfirmed: config.recruiterOutreach.liveActivationConfirmed, controlledSendConfirmation: process.env.RECRUITER_CONTROLLED_SEND_CONFIRM, controlledMessageId: process.env.RECRUITER_CONTROLLED_MESSAGE_ID?.trim() || null, controlledRecipient: process.env.RECRUITER_CONTROLLED_RECIPIENT?.trim().toLowerCase() || null, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail, maxMessagesPerDay: config.recruiterOutreach.maxMessagesPerDay, maxMessagesPerHour: config.recruiterOutreach.maxMessagesPerHour, resumePath: process.env.CANDIDATE_RESUME_PATH?.trim() || null, attachResume: process.env.RECRUITER_ATTACH_RESUME !== "false", maxAttachmentBytes: Number(process.env.RECRUITER_MAX_ATTACHMENT_BYTES ?? 10 * 1024 * 1024), externalSideEffectGate }), recruiterRepository, logger, recruiterFollowUpService);
    if (config.recruiterOutreach.followUpEnabled) recruiterFollowUpScheduler = new RecruiterOutreachFollowUpScheduler(recruiterRepository, recruiterSendDispatcher, true);
    if (gmailMailbox) recruiterReconciliationService = new RecruiterOutreachSendReconciliationService(database, recruiterRepository, gmailMailbox);
    recruiterRuntimeScheduler = new RecruiterOutreachRuntimeScheduler(recruiterFollowUpScheduler, recruiterReconciliationService, logger);
    recruiterDiscoveryDispatcher = new RecruiterDiscoveryTaskDispatcher(taskQueue); recruiterDiscoveryHandler = new RecruiterDiscoveryTaskHandler(discovery, config.recruiterOutreach.maxContactsPerApplication, recruiterPreparationDispatcher, logger);
    if (config.proactiveRecruiter.enabled) { proactiveRecruiterDispatcher = new ProactiveRecruiterTaskDispatcher(taskQueue); proactiveRecruiterHandler = new ProactiveRecruiterTaskHandler(new ProactiveRecruiterDiscoveryService(), new ProactiveRecruiterRepository(database), recruiterSendDispatcher, { enabled: config.proactiveRecruiter.enabled, sendEnabled: config.proactiveRecruiter.sendEnabled && config.gmail.enabled && config.outboundEnabled, maxCandidatesPerRun: config.proactiveRecruiter.maxCandidatesPerRun, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail }, logger); }
  }

  const applicationTaskHandler = new ApplicationTaskHandler(applicationRepository, submissionService, candidateProfiles, excludedCompanies, emailDispatcher, tailoredResumeArtifacts, tailoredResumeRepository, applicationAttemptRepository, recruiterDiscoveryDispatcher);
  const handlers = new Map<string, any>([[APPLY_JOB_TASK, applicationTaskHandler]]);
  if (emailHandler) handlers.set(SEND_APPLICATION_EMAIL_TASK, emailHandler); if (recruiterDiscoveryHandler) handlers.set(DISCOVER_RECRUITERS_TASK, recruiterDiscoveryHandler); if (recruiterPreparationHandler) handlers.set(PREPARE_RECRUITER_OUTREACH_TASK, recruiterPreparationHandler); if (recruiterSendHandler) handlers.set(SEND_RECRUITER_EMAIL_TASK, recruiterSendHandler); if (proactiveRecruiterHandler) { handlers.set(PROACTIVE_RECRUITER_DISCOVERY_TASK, proactiveRecruiterHandler); handlers.set(PROACTIVE_RECRUITER_OUTREACH_TASK, proactiveRecruiterHandler); }
  let discoveryRuntime: ReturnType<typeof createDiscoveryRuntime> | undefined;
  if (config.discoveryEnabled) { discoveryRuntime = createDiscoveryRuntime(database, taskQueue, config, candidateProfile); handlers.set(MATCH_JOB_TASK, discoveryRuntime.matchTaskHandler); logger.info({ sourceCount: discoveryRuntime.sourceCount }, "Discovery runtime enabled"); }
  if (gmailMailbox && interviewRepository) { handlers.set(SYNC_GMAIL_TASK, new GmailSyncTaskHandler(gmailMailbox, new GmailMessageRepository(database), interviewRepository, undefined, undefined, recruiterRepository ? new RecruiterOutreachInboundProcessor(recruiterRepository) : undefined)); gmailSyncDispatcher = new GmailSyncTaskDispatcher(taskQueue); }
  let followUpScheduler: FollowUpScheduler | undefined; if (config.gmail.enabled) { const followUpDrafts = new FollowUpDraftRepository(database); handlers.set(PREPARE_FOLLOW_UP_TASK, new FollowUpTaskHandler(followUpDrafts)); followUpScheduler = new FollowUpScheduler(followUpDrafts, new FollowUpTaskDispatcher(taskQueue)); }
  let interviewReminderScheduler: InterviewReminderScheduler | undefined; if (interviewRepository && emailNotifications && candidateProfile.email) { handlers.set(SEND_INTERVIEW_REMINDER_TASK, new InterviewReminderTaskHandler(emailNotifications, interviewRepository)); interviewReminderScheduler = new InterviewReminderScheduler(interviewRepository, new InterviewReminderTaskDispatcher(taskQueue), candidateProfile.email, candidateProfile.fullName ?? ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || "Candidate")); }
  const worker = new TaskWorker(taskQueue, handlers, { logger }); stopWorker = () => worker.stop();
  const applicationQueueService = new ApplicationQueueService(taskQueue, applicationRepository, new ApplicationRateLimitPolicy(config.applicationRateLimitPerDay), new ApplicationCompanyRateLimitPolicy(config.applicationCompanyRateLimitPerDay));
  const applicationLoop = (): Promise<void> => runPeriodicLoop({ name: "application-queue", intervalMs: config.applicationQueueIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { const result = await applicationQueueService.enqueueEligibleApplications(); logger.info({ queued: result.queued, rateLimited: result.rateLimited, submissionsUsed: result.submissionsUsed, submissionsRemaining: result.submissionsRemaining }, "Application queue cycle completed"); } });
  const staleSubmissionLoop = (): Promise<void> => runPeriodicLoop({ name: "stale-submission-monitor", intervalMs: config.staleSubmissionCheckIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { const result = await staleSubmissionMonitor.runOnce(config.staleSubmissionThresholdMinutes); if (result.requeued > 0) logger.info(result, "Stale application submissions requeued"); } });
  const discoveryLoop = (): Promise<void> => runPeriodicLoop({ name: "discovery", intervalMs: config.discoveryIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!discoveryRuntime) return; const results = await discoveryRuntime.runner.runOnce(); const backfill = await discoveryRuntime.matchQueueService.enqueueUnmatched(candidateProfile.id); for (const result of results) logger.info({ source: result.source, discovered: result.discovered, matching: result.matching }, "Discovery source run completed"); if (backfill.queued > 0) logger.info({ queued: backfill.queued }, "Stale/unmatched opportunities queued for matching"); } });
  const gmailSyncLoop = (): Promise<void> => runPeriodicLoop({ name: "gmail-sync", intervalMs: config.gmail.syncIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!gmailSyncDispatcher) return; await gmailSyncDispatcher.enqueue(); } });
  const interviewReminderLoop = (): Promise<void> => runPeriodicLoop({ name: "interview-reminders", intervalMs: config.interviewReminderIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!interviewReminderScheduler) return; await interviewReminderScheduler.runOnce(); } });
  const followUpLoop = (): Promise<void> => runPeriodicLoop({ name: "follow-ups", intervalMs: config.followUpIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!followUpScheduler) return; await followUpScheduler.runOnce(); } });
  const recruiterMaintenanceLoop = (): Promise<void> => runPeriodicLoop({ name: "recruiter-maintenance", intervalMs: config.followUpIntervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!recruiterRuntimeScheduler) return; await recruiterRuntimeScheduler.runOnce(); } });
  const proactiveRecruiterLoop = (): Promise<void> => runPeriodicLoop({ name: "proactive-recruiter-discovery", intervalMs: config.proactiveRecruiter.intervalMs, signal: shutdownController.signal, logger, sleep, runOnce: async () => { if (!proactiveRecruiterDispatcher || !config.proactiveRecruiter.enabled) return; await proactiveRecruiterDispatcher.enqueueDiscovery({ candidateProfileId: candidateProfile.id, candidateName: candidateProfile.fullName ?? ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || undefined), yearsExperience: candidateProfile.yearsExperience, skills: [...candidateProfile.skills], targetRoles: [...candidateProfile.targetTitles], location: candidateProfile.location, preferredLocations: csvEnvironment("CANDIDATE_PREFERRED_LOCATIONS"), remoteEligible: booleanEnvironment("CANDIDATE_REMOTE_ELIGIBLE", true), maxCandidates: config.proactiveRecruiter.maxCandidatesPerRun }); } });
  const loops: Array<Promise<void>> = [applicationLoop(), staleSubmissionLoop()]; if (discoveryRuntime) loops.push(discoveryLoop()); if (gmailSyncDispatcher) loops.push(gmailSyncLoop()); if (interviewReminderScheduler) loops.push(interviewReminderLoop()); if (followUpScheduler) loops.push(followUpLoop()); if (recruiterRuntimeScheduler) loops.push(recruiterMaintenanceLoop()); if (proactiveRecruiterDispatcher) loops.push(proactiveRecruiterLoop());
  await Promise.all([worker.run(), ...loops]); await database.close();
}
function booleanEnvironment(name: string, fallback: boolean): boolean { const value = process.env[name]; if (value === undefined) return fallback; return value === "true"; }
main().catch(async (error) => { logger.error({ err: error }, "job-agent crashed"); process.exitCode = 1; });
