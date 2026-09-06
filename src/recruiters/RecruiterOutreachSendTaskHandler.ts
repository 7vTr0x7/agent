import { ClaimedTask } from "../queue/TaskQueue";
import { RecruiterDiscoveryRepository, RecruiterOutreachMessageRecord } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";
import { SEND_RECRUITER_EMAIL_TASK, SendRecruiterEmailTaskPayload } from "./RecruiterOutreachSendTask";

export class RecruiterOutreachSendTaskHandler {
  constructor(
    private readonly sendService: RecruiterOutreachSendService,
    private readonly repository: RecruiterDiscoveryRepository,
    private readonly logger?: Pick<Console, "error" | "info">
  ) {}

  async handle(task: ClaimedTask<SendRecruiterEmailTaskPayload>): Promise<void> {
    if (task.taskType !== SEND_RECRUITER_EMAIL_TASK) {
      throw new Error(`Unsupported recruiter email task type: ${task.taskType}`);
    }

    try {
      // The message is intentionally reloaded through the database in production wiring;
      // this handler uses a narrow query helper so queued payloads cannot become stale content.
      const message = await loadMessage(this.repository, task.payload.messageId);
      if (!message) {
        this.logger?.info(`[recruiter-outreach] message ${task.payload.messageId} no longer exists; skipping.`);
        return;
      }
      const result = await this.sendService.send(message, task.payload.companyDomain);
      this.logger?.info(`[recruiter-outreach] message ${message.id}: ${result.status}${result.status === "SKIPPED" ? ` - ${result.reason}` : ""}`);
    } catch (error) {
      this.logger?.error(`[recruiter-outreach] send failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

async function loadMessage(
  repository: RecruiterDiscoveryRepository,
  messageId: string
): Promise<RecruiterOutreachMessageRecord | null> {
  return repository.getOutreachMessage(messageId);
}
