import { GmailApiMailbox } from "../email/GmailApiMailbox";
import { TaskQueue, TaskWorker } from "../queue/TaskQueue";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { AppConfig } from "../config/env";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";
import { RecruiterOutreachSendTaskDispatcher, SEND_RECRUITER_EMAIL_TASK } from "./RecruiterOutreachSendTask";
import { RecruiterOutreachSendTaskHandler } from "./RecruiterOutreachSendTaskHandler";
import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "./ProactiveRecruiterRepository";
import { ProactiveRecruiterTaskHandler } from "./ProactiveRecruiterTaskHandler";
import { ProactiveRecruiterTaskDispatcher, PROACTIVE_RECRUITER_DISCOVERY_TASK, PROACTIVE_RECRUITER_OUTREACH_TASK } from "./ProactiveRecruiterTask";

export interface ProactiveRecruiterRuntime {
  dispatcher: ProactiveRecruiterTaskDispatcher;
  handler: ProactiveRecruiterTaskHandler;
  sendHandler: RecruiterOutreachSendTaskHandler;
}

export function createProactiveRecruiterRuntime(
  database: ConstructorParameters<typeof RecruiterDiscoveryRepository>[0],
  taskQueue: TaskQueue,
  candidateProfile: CandidateProfile,
  config: AppConfig,
  gmailMailbox: GmailApiMailbox | undefined,
  logger: Pick<Console, "error" | "info">
): ProactiveRecruiterRuntime {
  const repository = new RecruiterDiscoveryRepository(database);
  const sendDispatcher = new RecruiterOutreachSendTaskDispatcher(taskQueue);
  const sendService = new RecruiterOutreachSendService({
    repository,
    database,
    mailbox: gmailMailbox,
    dryRun: config.recruiterOutreach.dryRun,
    outboundEnabled: config.outboundEnabled,
    gmailEnabled: config.gmail.enabled,
    automationEnabled: config.automationEnabled,
    activation: config.recruiterOutreach.activation,
    liveActivationConfirmed: config.recruiterOutreach.liveActivationConfirmed,
    controlledSendConfirmation: process.env.RECRUITER_CONTROLLED_SEND_CONFIRM,
    controlledMessageId: process.env.RECRUITER_CONTROLLED_MESSAGE_ID?.trim() || null,
    controlledRecipient: process.env.RECRUITER_CONTROLLED_RECIPIENT?.trim().toLowerCase() || null,
    requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail,
    maxMessagesPerDay: config.recruiterOutreach.maxMessagesPerDay,
    maxMessagesPerHour: config.recruiterOutreach.maxMessagesPerHour,
    resumePath: process.env.CANDIDATE_RESUME_PATH?.trim() || null,
    attachResume: process.env.RECRUITER_ATTACH_RESUME !== "false",
    maxAttachmentBytes: Number(process.env.RECRUITER_MAX_ATTACHMENT_BYTES ?? 10 * 1024 * 1024)
  });
  const sendHandler = new RecruiterOutreachSendTaskHandler(sendService, repository, logger);
  const dispatcher = new ProactiveRecruiterTaskDispatcher(taskQueue);
  const handler = new ProactiveRecruiterTaskHandler(
    new ProactiveRecruiterDiscoveryService(),
    new ProactiveRecruiterRepository(database),
    sendDispatcher,
    {
      enabled: config.proactiveRecruiter.enabled,
      sendEnabled: config.proactiveRecruiter.sendEnabled && config.gmail.enabled && config.outboundEnabled,
      maxCandidatesPerRun: config.proactiveRecruiter.maxCandidatesPerRun,
      requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail
    },
    logger
  );
  void candidateProfile;
  void TaskWorker;
  void SEND_RECRUITER_EMAIL_TASK;
  void PROACTIVE_RECRUITER_DISCOVERY_TASK;
  void PROACTIVE_RECRUITER_OUTREACH_TASK;
  return { dispatcher, handler, sendHandler };
}
