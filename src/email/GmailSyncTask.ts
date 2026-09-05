import { TaskQueue } from "../queue/TaskQueue";
import { GmailMailbox } from "./GmailMailbox";
import { GmailMessageRepository } from "./GmailMessageRepository";
import { InterviewRepository } from "./InterviewRepository";
import { InterviewDetailsExtractor } from "./InterviewDetailsExtractor";
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
    private readonly interviews?: InterviewRepository,
    private readonly classifier = new RecruiterEmailClassifier(),
    private readonly interviewExtractor = new InterviewDetailsExtractor()
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
      const applicationId = await this.messages.associateAndUpdateApplication(classified, classification);

      if (applicationId && classification === "INTERVIEW" && this.interviews) {
        const details = this.interviewExtractor.extract({
          subject: classified.subject,
          bodyText: classified.bodyText
        });
        await this.interviews.upsert(
          applicationId,
          classified.gmailMessageId,
          classified.gmailThreadId,
          details
        );
      }
    }
  }
}
