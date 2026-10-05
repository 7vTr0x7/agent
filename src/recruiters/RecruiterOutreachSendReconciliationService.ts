import { Database } from "../database/Database";
import { GmailMailbox } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { deterministicMessageId } from "./RecruiterOutreachSendService";

interface StaleSendingMessage { id: string; recipientEmail: string; subject: string; sendClaimedAt: Date; companyDomain: string; }
export interface RecruiterOutreachReconciliationResult { inspected: number; reconciled: number; requeued: number; unresolved: number; }

export class RecruiterOutreachSendReconciliationService {
  constructor(private readonly database: Database, private readonly repository: RecruiterDiscoveryRepository, private readonly mailbox: GmailMailbox, private readonly staleAfterMinutes = 15, private readonly sentMailboxScanLimit = 200) {}

  async runOnce(): Promise<RecruiterOutreachReconciliationResult> {
    if (this.staleAfterMinutes < 1) throw new Error("Recruiter reconciliation stale threshold must be positive.");
    if (this.sentMailboxScanLimit < 1) throw new Error("Recruiter reconciliation mailbox scan limit must be positive.");
    const result = await this.database.query<StaleSendingMessage>(
      `SELECT m.id,m.recipient_email AS "recipientEmail",m.subject,m.send_claimed_at AS "sendClaimedAt",c.company_domain AS "companyDomain"
         FROM recruiter_outreach_messages m
         JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id
         JOIN recruiter_contacts c ON c.id=s.recruiter_contact_id
        WHERE m.status='SENDING' AND m.send_claimed_at IS NOT NULL AND m.send_claimed_at<=NOW()-($1*INTERVAL '1 minute')
        ORDER BY m.send_claimed_at ASC LIMIT $2`,
      [this.staleAfterMinutes, this.sentMailboxScanLimit]
    );

    const sentMessages = new Map<string, { gmailMessageId: string; gmailThreadId: string }>();
    for (const stale of result.rows) {
      const ids = await this.mailbox.listMessages(`rfc822msgid:${deterministicMessageId(stale.id)}`, 10);
      for (const gmailMessageId of ids) {
        const message = await this.mailbox.getMessage(gmailMessageId);
        if (message.rfcMessageId === deterministicMessageId(stale.id) && message.recipientEmail?.toLowerCase().includes(stale.recipientEmail.toLowerCase()) && message.subject === stale.subject) {
          sentMessages.set(stale.id, { gmailMessageId: message.gmailMessageId, gmailThreadId: message.gmailThreadId });
          break;
        }
      }
    }

    let reconciled = 0;
    let unresolved = 0;
    for (const stale of result.rows) {
      const sent = sentMessages.get(stale.id);
      if (sent) {
        await this.repository.markOutreachMessageSent(stale.id, { provider: "gmail", providerMessageId: sent.gmailMessageId, providerThreadId: sent.gmailThreadId });
        await this.database.query(`UPDATE recruiter_outreach_messages SET send_state='SENT',client_message_id=COALESCE(client_message_id,$2),failure_reason=NULL,send_started_at=NULL,updated_at=NOW() WHERE id=$1`, [stale.id, deterministicMessageId(stale.id)]);
        reconciled += 1;
        continue;
      }
      // Absence is not proof of non-delivery. Never requeue automatically.
      unresolved += 1;
    }
    await this.reconcileInboundRepliesAndBounces();
    return { inspected: result.rows.length, reconciled, requeued: 0, unresolved };
  }
  private async reconcileInboundRepliesAndBounces(): Promise<void> {
    const active = await this.database.query<{
      sequenceId: string;
      recipientEmail: string;
      providerThreadId: string;
      providerMessageId: string;
      sentAt: Date;
    }>(
      "SELECT DISTINCT ON (s.id) s.id AS \"sequenceId\", canonical_contact.email AS \"recipientEmail\", " +
      "m.provider_thread_id AS \"providerThreadId\", m.provider_message_id AS \"providerMessageId\", m.sent_at AS \"sentAt\" " +
      "FROM recruiter_outreach_sequences s " +
      "JOIN recruiter_contacts c ON c.id=s.recruiter_contact_id " +
      "JOIN contacts canonical_contact ON canonical_contact.id=c.contact_id " +
      "JOIN recruiter_outreach_messages m ON m.sequence_id=s.id " +
      "WHERE s.status='ACTIVE' AND m.message_type='INITIAL' AND m.status='SENT' " +
      "AND m.provider_thread_id IS NOT NULL AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL " +
      "ORDER BY s.id,m.sent_at DESC LIMIT $1",
      [this.sentMailboxScanLimit]
    );

    for (const thread of active.rows) {
      let ids: readonly string[];
      try {
        ids = await this.mailbox.listMessages("thread:" + thread.providerThreadId, 50);
      } catch {
        continue;
      }
      for (const id of ids) {
        let message;
        try {
          message = await this.mailbox.getMessage(id);
        } catch {
          continue;
        }
        if (id === thread.providerMessageId) continue;
        if (!message.senderEmail || message.senderEmail.trim().toLowerCase() !== thread.recipientEmail.trim().toLowerCase()) continue;
        if (!message.receivedAt || message.receivedAt.getTime() <= new Date(thread.sentAt).getTime()) continue;

        await this.repository.stopOutreachSequence(
          thread.sequenceId,
          "Recipient replied to recruiter outreach; follow-ups are no longer appropriate."
        );

        if (/(?:no longer (?:work|working|employed)|no longer (?:with|at) (?:the )?company|left (?:the )?company|left (?:this|the) (?:organization|team)|not (?:working|employed) (?:at|with)|moved on|no longer part of|i(?:'|’)m no longer (?:working|employed)|niet meer werkzaam|niet meer in dienst|ik ben niet meer werkzaam|werk niet meer bij|niet meer bij|ja nao trabalho|já não trabalho|nao trabalho mais|não trabalho mais|nao estou mais|não estou mais|deixei de trabalhar|nao faco mais parte|não faço mais parte)/i.test(message.bodyText)) {
          await this.repository.suppressRecruiterEmail(
            thread.recipientEmail,
            "Recipient replied that they are no longer employed by the company.",
            "gmail_inbound_departed_reply"
          );
        }
        break;
      }
    }

    const recent = await this.database.query<{ recipientEmail: string }>(
      "SELECT DISTINCT LOWER(recipient_email) AS \"recipientEmail\" FROM recruiter_outreach_messages " +
      "WHERE status='SENT' AND sent_at IS NOT NULL AND sent_at >= NOW()-INTERVAL '45 days' LIMIT $1",
      [this.sentMailboxScanLimit * 4]
    );
    if (recent.rows.length === 0) return;

    let bounceIds: readonly string[];
    try {
      bounceIds = await this.mailbox.listMessages("newer_than:45d {from:mailer-daemon from:postmaster}", 100);
    } catch {
      return;
    }

    for (const id of bounceIds) {
      let message;
      try {
        message = await this.mailbox.getMessage(id);
      } catch {
        continue;
      }
      const text = (message.subject + " " + message.bodyText).toLowerCase();
      if (!/(address not found|delivery status notification|mail delivery subsystem|delivery failed|recipient address rejected|user unknown|mailbox unavailable|message not delivered)/i.test(text)) continue;

      for (const row of recent.rows) {
        const email = row.recipientEmail.trim().toLowerCase();
        if (!email || !text.includes(email)) continue;
        await this.repository.suppressRecruiterEmail(
          email,
          "Gmail reported that the recipient address could not be delivered.",
          "gmail_delivery_bounce"
        );
        await this.database.query(
          "UPDATE recruiter_outreach_sequences s SET status='STOPPED',next_action_at=NULL,updated_at=NOW() " +
          "WHERE s.status IN ('READY','ACTIVE','PAUSED') AND s.recruiter_contact_id IN (" +
          "SELECT c.id FROM recruiter_contacts c JOIN contacts canonical_contact ON canonical_contact.id=c.contact_id " +
          "WHERE LOWER(canonical_contact.email)=LOWER($1))",
          [email]
        );
        break;
      }
    }
  }

}
