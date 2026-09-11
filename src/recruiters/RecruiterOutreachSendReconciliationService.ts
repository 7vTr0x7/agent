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
    if (result.rows.length === 0) return { inspected: 0, reconciled: 0, requeued: 0, unresolved: 0 };

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
    return { inspected: result.rows.length, reconciled, requeued: 0, unresolved };
  }
}
