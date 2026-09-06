import { InterviewRepository } from "./InterviewRepository";
import { InterviewReminderTaskDispatcher } from "./InterviewReminderTask";

export interface InterviewReminderSchedulerResult {
  found: number;
  queued: number;
}

export class InterviewReminderScheduler {
  constructor(
    private readonly interviews: InterviewRepository,
    private readonly dispatcher: InterviewReminderTaskDispatcher,
    private readonly recipient: string,
    private readonly candidateName: string
  ) {}

  async runOnce(now = new Date()): Promise<InterviewReminderSchedulerResult> {
    const candidates = await this.interviews.findDueReminders(now, 50);
    let queued = 0;

    for (const candidate of candidates) {
      if (!candidate.dateText || !candidate.timeText || !candidate.timezone) continue;

      await this.dispatcher.enqueue({
        interviewId: candidate.id,
        recipient: this.recipient,
        candidateName: this.candidateName,
        jobTitle: candidate.jobTitle,
        companyName: candidate.companyName,
        interviewDateText: candidate.dateText,
        interviewTimeText: candidate.timeText,
        timezone: candidate.timezone,
        meetingUrl: candidate.meetingUrl
      });
      queued += 1;
    }

    return { found: candidates.length, queued };
  }
}
