import { Database } from "../database/Database";
import { GmailMessage } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

export type RecruiterInboundOutcome =
  | { status: "IGNORED"; reason: string }
  | { status: "REPLY_STOPPED"; sequenceId: string }
  | { status: "OPTOUT_SUPPRESSED"; sequenceId: string }
  | { status: "BOUNCE_SUPPRESSED"; sequenceId: string };

export interface RecruiterInboundRepository {
  findActiveOutreachSequenceByProviderMessage(gmailMessageId: string, gmailThreadId: string, rfcMessageId: string | null, inReplyTo: string | null): Promise<{ sequenceId: string; recipientEmail: string; companyDomain: string } | null>;
  stopOutreachSequence(sequenceId: string, reason: string): Promise<void>;
  suppressRecruiterEmail(email: string, reason: string, source: string): Promise<void>;
}

type RecruiterRepositoryDatabaseAccess = { database: Database };

export class RecruiterOutreachInboundProcessor {
  constructor(private readonly repository: RecruiterDiscoveryRepository) {}

  async process(message: GmailMessage): Promise<RecruiterInboundOutcome> {
    if (!message.senderEmail) return { status: "IGNORED", reason: "Inbound message has no sender email." };

    const sequence = await this.findActiveOutreachSequenceByProviderMessage(
      message.gmailMessageId,
      message.gmailThreadId,
      message.rfcMessageId,
      message.inReplyTo
    );
    if (!sequence) return { status: "IGNORED", reason: "Message is not linked to an active recruiter outreach sequence." };

    const content = `${message.subject}\n${message.bodyText}`.toLowerCase();
    if (isOptOut(content)) {
      await this.suppressRecruiterEmail(message.senderEmail, "OPTOUT", "gmail-reply");
      await this.repository.stopOutreachSequence(sequence.sequenceId, "Recruiter opted out of further outreach.");
      return { status: "OPTOUT_SUPPRESSED", sequenceId: sequence.sequenceId };
    }

    if (isBounce(content)) {
      await this.suppressRecruiterEmail(sequence.recipientEmail, "BOUNCE", "gmail-bounce");
      await this.repository.stopOutreachSequence(sequence.sequenceId, "Delivery failure/bounce received.");
      return { status: "BOUNCE_SUPPRESSED", sequenceId: sequence.sequenceId };
    }

    await this.repository.stopOutreachSequence(sequence.sequenceId, "Recruiter replied; follow-ups stopped.");
    return { status: "REPLY_STOPPED", sequenceId: sequence.sequenceId };
  }

  private get database(): Database {
    return (this.repository as unknown as RecruiterRepositoryDatabaseAccess).database;
  }

  private async findActiveOutreachSequenceByProviderMessage(
    gmailMessageId: string,
    gmailThreadId: string,
    rfcMessageId: string | null,
    inReplyTo: string | null
  ): Promise<{ sequenceId: string; recipientEmail: string; companyDomain: string } | null> {
    const result = await this.database.query<{
      sequence_id: string;
      recipient_email: string;
      company_domain: string;
    }>(
      `SELECT s.id AS sequence_id, c.email AS recipient_email, c.company_domain
       FROM recruiter_outreach_sequences s
       JOIN recruiter_contacts c ON c.id = s.recruiter_contact_id
       JOIN recruiter_outreach_messages m ON m.sequence_id = s.id
       WHERE s.status = 'ACTIVE'
         AND (
           m.provider_thread_id = $1
           OR m.provider_message_id = $2
           OR m.provider_message_id = $3
           OR m.provider_message_id = $4
         )
       ORDER BY m.sent_at DESC NULLS LAST, m.created_at DESC
       LIMIT 1`,
      [gmailThreadId, gmailMessageId, rfcMessageId, inReplyTo]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sequenceId: row.sequence_id,
      recipientEmail: row.recipient_email,
      companyDomain: row.company_domain
    };
  }

  private async suppressRecruiterEmail(email: string, reason: string, source: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    await this.database.query(
      `INSERT INTO recruiter_suppressions (email, reason, source)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM recruiter_suppressions WHERE LOWER(email) = LOWER($1)
       )`,
      [normalizedEmail, reason, source]
    );
  }
}

function isOptOut(content: string): boolean {
  return /\b(?:unsubscribe|remove me|remove my email|do not (?:email|contact) me|don't (?:email|contact) me|stop (?:emailing|contacting) me|no further (?:emails|contact)|opt[- ]?out)\b/i.test(content);
}

function isBounce(content: string): boolean {
  return /\b(?:delivery status notification|delivery failure|mail delivery failed|undeliverable|message not delivered|address not found|user unknown|mailbox unavailable|recipient address rejected)\b/i.test(content)
    || /mailer-daemon|postmaster/i.test(content);
}

export type RecruiterOutreachInboundProcessorRepository = RecruiterDiscoveryRepository;
