import { Database } from "../database/Database";
import { GmailClassification, GmailMessage } from "./GmailMailbox";

export interface StoredGmailMessage {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  applicationId: string | null;
}

export class GmailMessageRepository {
  constructor(private readonly database: Database) {}

  async save(message: GmailMessage): Promise<StoredGmailMessage> {
    const result = await this.database.query<StoredGmailMessage>(
      `
      INSERT INTO gmail_messages (
        gmail_message_id, gmail_thread_id, rfc_message_id, in_reply_to,
        sender_email, sender_name, recipient_email, subject, received_at,
        snippet, body_text, classification, processed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (gmail_message_id) DO UPDATE SET
        gmail_thread_id = EXCLUDED.gmail_thread_id,
        rfc_message_id = EXCLUDED.rfc_message_id,
        in_reply_to = EXCLUDED.in_reply_to,
        sender_email = EXCLUDED.sender_email,
        sender_name = EXCLUDED.sender_name,
        recipient_email = EXCLUDED.recipient_email,
        subject = EXCLUDED.subject,
        received_at = EXCLUDED.received_at,
        snippet = EXCLUDED.snippet,
        body_text = EXCLUDED.body_text,
        classification = EXCLUDED.classification,
        processed_at = NOW(),
        updated_at = NOW()
      RETURNING id, gmail_message_id AS "gmailMessageId", gmail_thread_id AS "gmailThreadId", application_id AS "applicationId"
      `,
      [
        message.gmailMessageId,
        message.gmailThreadId,
        message.rfcMessageId,
        message.inReplyTo,
        message.senderEmail,
        message.senderName,
        message.recipientEmail,
        message.subject,
        message.receivedAt,
        message.snippet,
        message.bodyText,
        message.classification
      ]
    );

    const stored = result.rows[0];
    if (!stored) throw new Error(`Failed to persist Gmail message '${message.gmailMessageId}'.`);
    return stored;
  }

  async associateAndUpdateApplication(
    message: GmailMessage,
    classification: GmailClassification
  ): Promise<string | null> {
    const result = await this.database.query<{ applicationId: string }>(
      `
      WITH candidates AS (
        SELECT
          a.id,
          a.email_thread_id,
          jo.company_name,
          jo.title,
          (
            CASE WHEN a.email_thread_id = $1 THEN 100 ELSE 0 END +
            CASE WHEN lower($2) LIKE '%' || lower(jo.company_name) || '%' THEN 35 ELSE 0 END +
            CASE WHEN lower($2) LIKE '%' || lower(jo.title) || '%' THEN 25 ELSE 0 END
          ) AS score
        FROM applications a
        JOIN job_opportunities jo ON jo.id = a.job_opportunity_id
        WHERE a.status NOT IN ('REJECTED','WITHDRAWN','CLOSED')
          AND (
            a.email_thread_id = $1
            OR lower($2) LIKE '%' || lower(jo.company_name) || '%'
            OR lower($2) LIKE '%' || lower(jo.title) || '%'
          )
      )
      SELECT id AS "applicationId"
      FROM candidates
      WHERE score >= 35
      ORDER BY score DESC
      LIMIT 1
      `,
      [message.gmailThreadId, `${message.subject}\n${message.bodyText}`]
    );

    const applicationId = result.rows[0]?.applicationId ?? null;
    if (!applicationId) return null;

    await this.database.transaction(async (client) => {
      const status = classification === "REJECTION" ? "REJECTED" : "RESPONDED";
      await client.query(
        `
        UPDATE applications
        SET email_thread_id = $1,
            status = CASE
              WHEN status IN ('SENT','FOLLOW_UP_DUE') THEN $2
              ELSE status
            END,
            updated_at = NOW()
        WHERE id = $3
        `,
        [message.gmailThreadId, status, applicationId]
      );

      await client.query(
        `
        UPDATE gmail_messages
        SET application_id = $1, classification = $2, processed_at = NOW(), updated_at = NOW()
        WHERE gmail_message_id = $3
        `,
        [applicationId, classification, message.gmailMessageId]
      );
    });

    return applicationId;
  }
}
