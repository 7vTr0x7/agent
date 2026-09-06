import { ClaimedTask } from "../queue/TaskQueue";
import { EmailNotificationService } from "./EmailNotificationService";
import {
  ApplicationEmailTaskPayload,
  SEND_APPLICATION_EMAIL_TASK
} from "./EmailNotificationTask";

export class EmailNotificationTaskHandler {
  constructor(private readonly notifications: EmailNotificationService) {}

  async handle(task: ClaimedTask<ApplicationEmailTaskPayload>): Promise<void> {
    if (task.taskType !== SEND_APPLICATION_EMAIL_TASK) {
      throw new Error(`Unsupported email notification task type: ${task.taskType}`);
    }

    if (task.payload.kind === "SUBMITTED") {
      await this.notifications.applicationSubmitted(task.payload.context);
      return;
    }

    await this.notifications.applicationBlocked(task.payload.context);
  }
}
