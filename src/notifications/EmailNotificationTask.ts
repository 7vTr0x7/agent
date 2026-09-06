import { TaskQueue } from "../queue/TaskQueue";
import { ApplicationEmailContext } from "./Email";
import { InterviewReminderContext } from "./EmailNotificationService";

export const SEND_APPLICATION_EMAIL_TASK = "SEND_APPLICATION_EMAIL";

export interface ApplicationEmailTaskPayload {
  kind: "SUBMITTED" | "BLOCKED" | "INTERVIEW_REMINDER";
  context: ApplicationEmailContext | InterviewReminderContext;
}

export class EmailNotificationTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueueApplicationSubmitted(context: ApplicationEmailContext): Promise<string> {
    return this.enqueue("SUBMITTED", context);
  }

  async enqueueApplicationBlocked(context: ApplicationEmailContext): Promise<string> {
    return this.enqueue("BLOCKED", context);
  }

  async enqueueInterviewReminder(context: InterviewReminderContext): Promise<string> {
    return this.enqueue("INTERVIEW_REMINDER", context);
  }

  private async enqueue(
    kind: ApplicationEmailTaskPayload["kind"],
    context: ApplicationEmailTaskPayload["context"]
  ): Promise<string> {
    const keyContext = "applicationId" in context
      ? context.applicationId
      : `${context.companyName}:${context.jobTitle}:${context.interviewDateText}:${context.interviewTimeText}`;

    return this.queue.enqueue<ApplicationEmailTaskPayload>({
      taskType: SEND_APPLICATION_EMAIL_TASK,
      payload: { kind, context },
      priority: 200,
      dedupeKey: `application-email:${kind.toLowerCase()}:${keyContext}`
    });
  }
}
