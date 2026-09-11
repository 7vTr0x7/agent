import { Database } from "../database/Database";
import { GmailMailbox } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

export type GmailSendReconciliationResult =
  | { status: "FOUND"; messageId: string; gmailMessageId: string; gmailThreadId: string }
  | { status: "INCONCLUSIVE"; messageId: string; reason: string }
  | { status: "NOT_ELIGIBLE"; messageId: string; reason: string };

export class RecruiterOutreachGmailReconciliation {
  constructor(
    private readonly database: Database,
    private readonly mailbox: GmailMailbox,
    private readonly repository: RecruiterDiscoveryRepository
  ) {}

  async reconcile(messageId: string): Promise<GmailSendReconciliationResult> {
    const result = await this.database.query<any>(
      `SELECT m.id,m.status,m.send_state,m.client_message_id,m.recipient_email,m.subject,
              m.sequence_id,s.status AS sequence_status,s.job_opportunity_id,c.email AS contact_email
         FROM recruiter_outreach_messages m
         JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id
         JOIN recruiter_contacts c ON c.id=s.recruiter_contact_id
        WHERE m.id=$1`,
      [messageId]
    );
    const row = result.rows[0];
    if (!row) return { status: "NOT_ELIGIBLE", messageId, reason: "Outreach message does not exist." };
    if (row.status === "SENT" || row.send_state === "SENT") {
      return { status: "NOT_ELIGIBLE", messageId, reason: "Outreach message is already SENT; reconciliation will not send or mutate it." };
    }
    if (row.status !== "SENDING" || row.send_state !== "AMBIGUOUS") {
      return { status: "NOT_ELIGIBLE", messageId, reason: `Outreach message is not in the expected ambiguous state (status=${row.status}, send_state=${row.send_state}).` };
    }
    if (!row.client_message_id) return { status: "INCONCLUSIVE", messageId, reason: "No deterministic client Message-ID was persisted before the ambiguous send." };
    if (!row.job_opportunity_id || String(row.recipient_email).toLowerCase() !== String(row.contact_email).toLowerCase()) {
      return { status: "NOT_ELIGIBLE", messageId, reason: "Outreach record is not safely associated with its recruiter and job." };
    }

    const ids = await this.mailbox.listMessages(`rfc822msgid:${row.client_message_id}`, 10);
    for (const id of ids) {
      const message = await this.mailbox.getMessage(id);
      if (message.rfcMessageId?.trim() !== row.client_message_id.trim()) continue;
      if (message.recipientEmail?.toLowerCase().includes(String(row.recipient_email).toLowerCase()) !== true) continue;
      if (message.subject !== row.subject) continue;
      await this.repository.markOutreachMessageSent(messageId, {
        provider: "gmail",
        providerMessageId: message.gmailMessageId,
        providerThreadId: message.gmailThreadId
      });
      await this.database.query(
        `UPDATE recruiter_outreach_messages SET send_state='SENT',failure_reason=NULL,send_started_at=NULL,updated_at=NOW() WHERE id=$1`,
        [messageId]
      );
      return { status: "FOUND", messageId, gmailMessageId: message.gmailMessageId, gmailThreadId: message.gmailThreadId };
    }

    // A negative Gmail search is not proof of non-delivery. Keep the record ambiguous
    // and require an explicit, separately reviewed retry policy rather than sending again.
    return { status: "INCONCLUSIVE", messageId, reason: "Deterministic Gmail reconciliation found no matching message; delivery remains ambiguous and no retry was issued." };
  }
}
