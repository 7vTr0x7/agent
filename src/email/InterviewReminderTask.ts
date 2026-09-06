import { TaskQueue } from "../queue/TaskQueue";

export const SEND_INTERVIEW_REMINDER_TASK = "SEND_INTERVIEW_REMINDER";

export interface InterviewReminderTaskPayload {
  interviewId: string;
  recipient: string;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  interviewDateText: string;
  interviewTimeText: string;
  timezone: string;
  meetingUrl: string | null;
}

export class InterviewReminderTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(payload: InterviewReminderTaskPayload): Promise<string> {
    return this.queue.enqueue<InterviewReminderTaskPayload>({
      taskType: SEND_INTERVIEW_REMINDER_TASK,
      payload,
      priority: 300,
      dedupeKey: `interview-reminder:${payload.interviewId}`
    });
  }
}
