import { Database } from "../database/Database";
import { InterviewDetails } from "./InterviewDetailsExtractor";

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
}

export class InterviewRepository {
  constructor(private readonly database: Database) {}

  async upsert(
    applicationId: string,
    gmailMessageId: string,
    gmailThreadId: string,
    details: InterviewDetails
  ): Promise<StoredInterview> {
    const result = await this.database.query<StoredInterview>(
      `
      INSERT INTO interviews (
        application_id, gmail_message_id, gmail_thread_id,
        date_text, time_text, timezone, meeting_url, meeting_provider,
        status, reminder_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SCHEDULED',NULL)
      ON CONFLICT (gmail_message_id) DO UPDATE SET
        application_id = EXCLUDED.application_id,
        gmail_thread_id = EXCLUDED.gmail_thread_id,
        date_text = EXCLUDED.date_text,
        time_text = EXCLUDED.time_text,
        timezone = EXCLUDED.timezone,
        meeting_url = EXCLUDED.meeting_url,
        meeting_provider = EXCLUDED.meeting_provider,
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
        reminder_at AS "reminderAt"
      `,
      [
        applicationId,
        gmailMessageId,
        gmailThreadId,
        details.dateText,
        details.timeText,
        details.timezone,
        details.meetingUrl,
        details.meetingProvider
      ]
    );

    const interview = result.rows[0];
    if (!interview) {
      throw new Error(`Failed to persist interview for Gmail message '${gmailMessageId}'.`);
    }
    return interview;
  }
}
