import { ClaimedTask } from "../queue/TaskQueue";
import { InterviewRepository } from "./InterviewRepository";
import { InterviewReminderTaskPayload, SEND_INTERVIEW_REMINDER_TASK } from "./InterviewReminderTask";
import { EmailNotificationService } from "../notifications/EmailNotificationService";

export class InterviewReminderTaskHandler {
  constructor(
    private readonly notifications: EmailNotificationService,
    private readonly interviews: InterviewRepository
  ) {}

  async handle(task: ClaimedTask<InterviewReminderTaskPayload>): Promise<void> {
    if (task.taskType !== SEND_INTERVIEW_REMINDER_TASK) {
      throw new Error(`Unsupported interview reminder task type: ${task.taskType}`);
    }

    await this.notifications.interviewReminder(task.payload);
    await this.interviews.markReminderSent(task.payload.interviewId);
  }
}
