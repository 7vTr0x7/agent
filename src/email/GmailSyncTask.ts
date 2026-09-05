import { TaskQueue } from "../queue/TaskQueue";
import { GmailMailbox } from "./GmailMailbox";
import { GmailMessageRepository } from "./GmailMessageRepository";
import { RecruiterEmailClassifier } from "./RecruiterEmailClassifier";

export const SYNC_GMAIL_TASK = "SYNC_GMAIL";

export interface GmailSyncTaskPayload {
  query: string;
  maxResults: number;
}

export class GmailSyncTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(query = "newer_than:14d -from:me", maxResults = 50): Promise<string> {
    return this.queue.enqueue<GmailSyncTaskPayload>({
      taskType: SYNC_GMAIL_TASK,
      payload: { query, maxResults },
      priority: 50,
      dedupeKey: "gmail:sync"
    });
  }
}

export class GmailSyncTaskHandler {
  constructor(
    private readonly mailbox: GmailMailbox,
    private readonly messages: GmailMessageRepository,
    private readonly classifier = new RecruiterEmailClassifier()
  ) {}

  async handle(task: { taskType: string; payload: GmailSyncTaskPayload }): Promise<void> {
    if (task.taskType !== SYNC_GMAIL_TASK) {
      throw new Error(`Unsupported Gmail task type: ${task.taskType}`);
    }

    const ids = await this.mailbox.listMessages(task.payload.query, task.payload.maxResults);
    for (const id of ids) {
      const message = await this.mailbox.getMessage(id);
      const classification = this.classifier.classify(message);
      const classified = { ...message, classification };
      await this.messages.save(classified);
      await this.messages.associateAndUpdateApplication(classified, classification);
    }
  }
}
