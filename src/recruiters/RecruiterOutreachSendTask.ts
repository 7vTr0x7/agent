import { TaskQueue } from "../queue/TaskQueue";

export const SEND_RECRUITER_EMAIL_TASK = "SEND_RECRUITER_EMAIL";

export interface SendRecruiterEmailTaskPayload {
  messageId: string;
  companyDomain: string;
}

export class RecruiterOutreachSendTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(payload: SendRecruiterEmailTaskPayload, priority = 30): Promise<string> {
    return this.queue.enqueue<SendRecruiterEmailTaskPayload>({
      taskType: SEND_RECRUITER_EMAIL_TASK,
      payload,
      priority,
      dedupeKey: `recruiter-email-send:${payload.messageId}`
    });
  }
}
