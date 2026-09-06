import { TaskQueue } from "../queue/TaskQueue";
import { ApplicationEmailContext } from "./Email";

export const SEND_APPLICATION_EMAIL_TASK = "SEND_APPLICATION_EMAIL";

export interface ApplicationEmailTaskPayload {
  kind: "SUBMITTED" | "BLOCKED";
  context: ApplicationEmailContext;
}

export class EmailNotificationTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueueApplicationSubmitted(context: ApplicationEmailContext): Promise<string> {
    return this.enqueue("SUBMITTED", context);
  }

  async enqueueApplicationBlocked(context: ApplicationEmailContext): Promise<string> {
    return this.enqueue("BLOCKED", context);
  }

  private async enqueue(
    kind: ApplicationEmailTaskPayload["kind"],
    context: ApplicationEmailContext
  ): Promise<string> {
    return this.queue.enqueue<ApplicationEmailTaskPayload>({
      taskType: SEND_APPLICATION_EMAIL_TASK,
      payload: { kind, context },
      priority: 100,
      dedupeKey: `application-email:${kind.toLowerCase()}:${context.applicationId}`
    });
  }
}
