import { Database } from "../database/Database";
import { InterviewDetails } from "./InterviewDetailsExtractor";
import { calculateInterviewReminderAt } from "./InterviewReminderTime";

export interface StoredInterview {
  id: string;
  applicationId: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  dateText: string | null;
  timeText: string | null;
  timezone: string | null;
  meetingUrl: string | null;
  meetingProvider: InterviewDetails["meetingProvider"];
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  reminderAt: Date | null;
  reminderSentAt: Date | null;
}

export interface DueInterviewReminder {
  id: string;
  applicationId: string;
  jobTitle: string;
  companyName: string;
  dateText: string | null;
  timeText: string | null;
  timezone: string | null;
  meetingUrl: string | null;
}

export class InterviewRepository {
  constructor(private readonly database: Database) {}

  async upsert(
    applicationId: string,
    gmailMessageId: string,
    gmailThreadId: string,
    details: InterviewDetails
  ): Promise<StoredInterview> {
    const reminderAt = calculateInterviewReminderAt(details);
    const result = await this.database.query<StoredInterview>(
      `
      INSERT INTO interviews (
        application_id, gmail_message_id, gmail_thread_id,
        date_text, time_text, timezone, meeting_url, meeting_provider,
        status, reminder_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SCHEDULED',$9)
      ON CONFLICT (gmail_message_id) DO UPDATE SET
        application_id = EXCLUDED.application_id,
        gmail_thread_id = EXCLUDED.gmail_thread_id,
        date_text = EXCLUDED.date_text,
        time_text = EXCLUDED.time_text,
        timezone = EXCLUDED.timezone,
        meeting_url = EXCLUDED.meeting_url,
        meeting_provider = EXCLUDED.meeting_provider,
        reminder_at = EXCLUDED.reminder_at,
        reminder_sent_at = CASE
          WHEN interviews.reminder_at IS DISTINCT FROM EXCLUDED.reminder_at THEN NULL
          ELSE interviews.reminder_sent_at
        END,
        updated_at = NOW()
      RETURNING
        id,
        application_id AS "applicationId",
        gmail_message_id AS "gmailMessageId",
        gmail_thread_id AS "gmailThreadId",
        date_text AS "dateText",
        time_text AS "timeText",
        timezone,
        meeting_url AS "meetingUrl",
        meeting_provider AS "meetingProvider",
        status,
        reminder_at AS "reminderAt",
        reminder_sent_at AS "reminderSentAt"
      `,
      [
        applicationId,
        gmailMessageId,
        gmailThreadId,
        details.dateText,
        details.timeText,
        details.timezone,
        details.meetingUrl,
        details.meetingProvider,
        reminderAt
      ]
    );

    const interview = result.rows[0];
    if (!interview) {
      throw new Error(`Failed to persist interview for Gmail message '${gmailMessageId}'.`);
    }
    return interview;
  }

  async findDueReminders(now: Date, limit = 50): Promise<readonly DueInterviewReminder[]> {
    const result = await this.database.query<DueInterviewReminder>(
      `
      SELECT
        i.id,
        i.application_id AS "applicationId",
        jo.title AS "jobTitle",
        jo.company_name AS "companyName",
        i.date_text AS "dateText",
        i.time_text AS "timeText",
        i.timezone,
        i.meeting_url AS "meetingUrl"
      FROM interviews i
      JOIN applications a ON a.id = i.application_id
      JOIN job_opportunities jo ON jo.id = a.job_opportunity_id
      WHERE i.status = 'SCHEDULED'
        AND i.reminder_at IS NOT NULL
        AND i.reminder_at <= $1
        AND i.reminder_sent_at IS NULL
      ORDER BY i.reminder_at ASC
      LIMIT $2
      `,
      [now, limit]
    );
    return result.rows;
  }

  async markReminderSent(interviewId: string, sentAt = new Date()): Promise<void> {
    await this.database.query(
      `
      UPDATE interviews
      SET reminder_sent_at = $2, updated_at = NOW()
      WHERE id = $1 AND reminder_sent_at IS NULL
      `,
      [interviewId, sentAt]
    );
  }
}
