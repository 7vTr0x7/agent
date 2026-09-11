import fs from "node:fs/promises";
import path from "node:path";
import { GmailAttachment, GmailMailbox } from "../email/GmailMailbox";
import { Database } from "../database/Database";
import { RecruiterDiscoveryRepository, RecruiterOutreachMessageRecord } from "./RecruiterDiscoveryRepository";
import { evaluateRecruiterOutreachActivation, RecruiterOutreachActivation } from "./RecruiterOutreachActivationGate";

export interface RecruiterOutreachSendOptions {
  repository: RecruiterDiscoveryRepository;
  database?: Database;
  mailbox?: GmailMailbox;
  dryRun?: boolean;
  outboundEnabled?: boolean;
  gmailEnabled?: boolean;
  automationEnabled?: boolean;
  activation?: RecruiterOutreachActivation;
  liveActivationConfirmed?: boolean;
  controlledSendConfirmation?: string;
  controlledMessageId?: string | null;
  controlledRecipient?: string | null;
  requireVerifiedEmail?: boolean;
  maxMessagesPerDay?: number;
  maxMessagesPerHour?: number;
  resumePath?: string | null;
  attachResume?: boolean;
  maxAttachmentBytes?: number;
}

export type RecruiterOutreachSendResult =
  | { status: "DRY_RUN"; messageId: string }
  | { status: "SENT"; messageId: string; gmailMessageId: string; gmailThreadId: string }
  | { status: "SKIPPED"; messageId: string; reason: string };

function deterministicMessageId(messageId: string): string {
  return `<recruiter-outreach-${messageId}@job-agent.local>`;
}

const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const RESUME_DIRECTORIES = ["/app/data/resumes", "./data/resumes", "./resumes"];

function attachmentContentType(filePath: string): string {
  return path.extname(filePath).toLowerCase() === ".pdf" ? "application/pdf" : "application/octet-stream";
}

async function resolveResumePath(configuredPath: string | null | undefined): Promise<string | null> {
  if (configuredPath?.trim()) return configuredPath.trim();
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const directory of RESUME_DIRECTORIES) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !/\.pdf$/i.test(entry.name)) continue;
        const candidatePath = path.join(directory, entry.name);
        const stat = await fs.stat(candidatePath);
        if (stat.isFile()) candidates.push({ path: candidatePath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Optional resume directories are allowed to be absent in dry-run/controlled tests.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  return candidates[0]?.path ?? null;
}

async function loadResumeAttachment(resumePath: string | null | undefined, maxBytes: number): Promise<GmailAttachment | null> {
  const selectedPath = await resolveResumePath(resumePath);
  if (!selectedPath) return null;
  const resolved = path.resolve(selectedPath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`Configured recruiter resume path is not a file: ${resolved}`);
  if (stat.size <= 0) throw new Error(`Configured recruiter resume file is empty: ${resolved}`);
  if (stat.size > maxBytes) throw new Error(`Configured recruiter resume exceeds the ${maxBytes}-byte attachment safety limit.`);
  const content = await fs.readFile(resolved);
  return { filename: path.basename(resolved), contentType: attachmentContentType(resolved), content };
}

interface ClaimedSendRecord extends RecruiterOutreachMessageRecord {
  recruiterContactId: string;
  recruiterVerified: boolean;
  recruiterVerificationStatus: string | null;
  companyDomain: string;
  jobOpportunityId: string | null;
  candidateProfileId: string;
  clientMessageId: string;
}

export class RecruiterOutreachSendService {
  private readonly dryRun: boolean;
  private readonly outboundEnabled: boolean;
  private readonly gmailEnabled: boolean;
  private readonly automationEnabled: boolean;
  private readonly activation: RecruiterOutreachActivation;
  private readonly liveActivationConfirmed: boolean;
  private readonly controlledSendConfirmation: string | undefined;
  private readonly controlledMessageId: string | null;
  private readonly controlledRecipient: string | null;
  private readonly requireVerifiedEmail: boolean;
  private readonly maxMessagesPerDay: number;
  private readonly maxMessagesPerHour: number;
  private readonly resumePath: string | null;
  private readonly attachResume: boolean;
  private readonly maxAttachmentBytes: number;

  constructor(private readonly options: RecruiterOutreachSendOptions) {
    this.dryRun = options.dryRun ?? true;
    this.outboundEnabled = options.outboundEnabled ?? false;
    this.gmailEnabled = options.gmailEnabled ?? (process.env.GMAIL_ENABLED === "true");
    this.automationEnabled = options.automationEnabled ?? (process.env.AUTOMATION_ENABLED === "true");
    this.activation = options.activation ?? "disabled";
    this.liveActivationConfirmed = options.liveActivationConfirmed ?? false;
    this.controlledSendConfirmation = options.controlledSendConfirmation ?? process.env.RECRUITER_CONTROLLED_SEND_CONFIRM;
    this.controlledMessageId = options.controlledMessageId ?? process.env.RECRUITER_CONTROLLED_MESSAGE_ID?.trim() ?? null;
    this.controlledRecipient = options.controlledRecipient ?? process.env.RECRUITER_CONTROLLED_RECIPIENT?.trim().toLowerCase() ?? null;
    this.requireVerifiedEmail = options.requireVerifiedEmail ?? true;
    this.maxMessagesPerDay = options.maxMessagesPerDay ?? 20;
    this.maxMessagesPerHour = options.maxMessagesPerHour ?? 5;
    this.resumePath = options.resumePath?.trim() || process.env.CANDIDATE_RESUME_PATH?.trim() || null;
    const value = process.env.RECRUITER_ATTACH_RESUME;
    this.attachResume = options.attachResume ?? (value === undefined ? true : value === "true");
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? Number(process.env.RECRUITER_MAX_ATTACHMENT_BYTES ?? DEFAULT_MAX_ATTACHMENT_BYTES);
    if (!Number.isInteger(this.maxMessagesPerDay) || this.maxMessagesPerDay < 1) throw new Error("Recruiter daily send limit must be a positive integer.");
    if (!Number.isInteger(this.maxMessagesPerHour) || this.maxMessagesPerHour < 1) throw new Error("Recruiter hourly send limit must be a positive integer.");
    if (!Number.isInteger(this.maxAttachmentBytes) || this.maxAttachmentBytes < 1) throw new Error("Recruiter attachment size limit must be a positive integer.");
  }

  async send(message: RecruiterOutreachMessageRecord, companyDomain: string): Promise<RecruiterOutreachSendResult> {
    if (message.status !== "PREPARED") return { status: "SKIPPED", messageId: message.id, reason: `Message is not PREPARED (status=${message.status}).` };
    if (this.controlledMessageId && message.id !== this.controlledMessageId && !this.dryRun) return { status: "SKIPPED", messageId: message.id, reason: "Controlled Phase 6 activation is restricted to the explicitly selected outreach message." };
    if (this.controlledRecipient && message.recipientEmail.toLowerCase() !== this.controlledRecipient && !this.dryRun) return { status: "SKIPPED", messageId: message.id, reason: "Controlled Phase 6 activation is restricted to the explicitly selected recipient." };

    const sequence = await this.options.repository.getOutreachSequence(message.sequenceId);
    if (!sequence) return { status: "SKIPPED", messageId: message.id, reason: "Outreach sequence no longer exists." };
    if (sequence.status !== "READY" && sequence.status !== "ACTIVE") return { status: "SKIPPED", messageId: message.id, reason: `Outreach sequence is not sendable (status=${sequence.status}).` };
    if (!sequence.jobOpportunityId) return { status: "SKIPPED", messageId: message.id, reason: "Controlled recruiter outreach requires a job-associated sequence." };

    const suppression = await this.options.repository.isSuppressed(message.recipientEmail, companyDomain);
    if (suppression.email || suppression.domain) return { status: "SKIPPED", messageId: message.id, reason: suppression.email ? "Recipient is suppressed." : "Company domain is suppressed." };

    if (this.dryRun) return { status: "DRY_RUN", messageId: message.id };

    const activation = evaluateRecruiterOutreachActivation({
      activation: this.activation,
      dryRun: this.dryRun,
      liveActivationConfirmed: this.liveActivationConfirmed,
      controlledSendConfirmation: this.controlledSendConfirmation,
      maxMessagesPerDay: this.maxMessagesPerDay,
      maxMessagesPerHour: this.maxMessagesPerHour
    });
    if (!activation.allowed) return { status: "SKIPPED", messageId: message.id, reason: activation.reason };
    if (this.automationEnabled) return { status: "SKIPPED", messageId: message.id, reason: "Phase 6 controlled activation refuses broad automation; AUTOMATION_ENABLED must remain false." };
    if (!this.outboundEnabled) return { status: "SKIPPED", messageId: message.id, reason: "Global outbound kill switch is disabled." };
    if (!this.gmailEnabled) return { status: "SKIPPED", messageId: message.id, reason: "Gmail sending is disabled." };
    if (!this.options.mailbox) return { status: "SKIPPED", messageId: message.id, reason: "Gmail mailbox is not configured for live recruiter outreach." };
    if (!this.options.database) return { status: "SKIPPED", messageId: message.id, reason: "Controlled Gmail sending requires database-backed atomic claim and reconciliation." };

    const clientMessageId = deterministicMessageId(message.id);
    const claimed = await this.claimWithDatabase(message.id, clientMessageId);
    if (!claimed) return { status: "SKIPPED", messageId: message.id, reason: "Message was already claimed, sent, suppressed, or is no longer eligible." };

    let resumeAttachment: GmailAttachment | null = null;
    try {
      resumeAttachment = this.attachResume && claimed.messageType === "INITIAL" ? await loadResumeAttachment(this.resumePath, this.maxAttachmentBytes) : null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.markClaimFailed(claimed.id, reason);
      throw error;
    }

    try {
      const sent = await this.options.mailbox.sendMessage({
        to: claimed.recipientEmail,
        subject: claimed.subject,
        bodyText: claimed.body,
        messageId: claimed.clientMessageId,
        attachments: resumeAttachment ? [resumeAttachment] : undefined
      });
      await this.options.repository.markOutreachMessageSent(claimed.id, {
        provider: "gmail",
        providerMessageId: sent.gmailMessageId,
        providerThreadId: sent.gmailThreadId
      });
      await this.options.database.query(
        `UPDATE recruiter_outreach_messages SET send_state='SENT',failure_reason=NULL,send_started_at=NULL,updated_at=NOW() WHERE id=$1`,
        [claimed.id]
      );
      return { status: "SENT", messageId: claimed.id, gmailMessageId: sent.gmailMessageId, gmailThreadId: sent.gmailThreadId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.options.database.query(
        `UPDATE recruiter_outreach_messages SET send_state='AMBIGUOUS',failure_reason=$2,updated_at=NOW() WHERE id=$1 AND status='SENDING'`,
        [claimed.id, reason]
      );
      throw error;
    }
  }

  private async claimWithDatabase(messageId: string, clientMessageId: string): Promise<ClaimedSendRecord | null> {
    const database = this.options.database!;
    return database.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('job-agent:recruiter-outreach-rate-limit'))`);
      const result = await client.query<any>(
        `SELECT m.id,m.sequence_id,m.message_type,m.sequence_step,m.recipient_email,m.subject,m.body,m.status,
                s.recruiter_contact_id,s.job_opportunity_id,s.candidate_profile_id,
                c.company_domain,c.email AS contact_email,c.verified AS recruiter_verified,
                c.verification_status AS recruiter_verification_status,
                m.send_state,m.client_message_id AS existing_client_message_id
           FROM recruiter_outreach_messages m
           JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id
           JOIN recruiter_contacts c ON c.id=s.recruiter_contact_id
          WHERE m.id=$1
          FOR UPDATE OF m,s,c`,
        [messageId]
      );
      const row = result.rows[0];
      if (!row || row.status !== "PREPARED") return null;
      if (row.job_opportunity_id === null) return null;
      if (String(row.recipient_email).toLowerCase() !== String(row.contact_email).toLowerCase()) return null;
      if (this.requireVerifiedEmail && !row.recruiter_verified) return null;
      if (row.send_state === "SENT" || row.send_state === "AMBIGUOUS") return null;
      if (this.controlledRecipient && String(row.recipient_email).toLowerCase() !== this.controlledRecipient) return null;

      const suppression = await client.query<{ suppressed: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM recruiter_suppressions x WHERE LOWER(COALESCE(x.email,''))=LOWER($1) OR LOWER(COALESCE(x.company_domain,''))=LOWER($2)) AS suppressed`,
        [row.recipient_email, row.company_domain]
      );
      if (suppression.rows[0]?.suppressed) return null;

      const counts = await client.query<{ day_count: string; hour_count: string }>(
        `SELECT COUNT(*) FILTER (WHERE status='SENT' AND sent_at >= NOW()-INTERVAL '24 hours')::text AS day_count,
                COUNT(*) FILTER (WHERE status='SENT' AND sent_at >= NOW()-INTERVAL '1 hour')::text AS hour_count
           FROM recruiter_outreach_messages`
      );
      const dayCount = Number(counts.rows[0]?.day_count ?? 0);
      const hourCount = Number(counts.rows[0]?.hour_count ?? 0);
      if (dayCount >= this.maxMessagesPerDay || hourCount >= this.maxMessagesPerHour) return null;

      const updated = await client.query<any>(
        `UPDATE recruiter_outreach_messages
            SET status='SENDING',send_state='SENDING',client_message_id=$2,send_attempt_count=COALESCE(send_attempt_count,0)+1,
                send_started_at=NOW(),send_claimed_at=NOW(),failure_reason=NULL,updated_at=NOW()
          WHERE id=$1 AND status='PREPARED' AND (send_state IS NULL OR send_state='READY')
          RETURNING id,sequence_id,message_type,sequence_step,recipient_email,subject,body,status`,
        [messageId, clientMessageId]
      );
      const claimed = updated.rows[0];
      if (!claimed) return null;
      return {
        ...claimed,
        recruiterContactId: row.recruiter_contact_id,
        recruiterVerified: Boolean(row.recruiter_verified),
        recruiterVerificationStatus: row.recruiter_verification_status ?? null,
        companyDomain: row.company_domain,
        jobOpportunityId: row.job_opportunity_id,
        candidateProfileId: row.candidate_profile_id,
        clientMessageId
      };
    });
  }

  private async markClaimFailed(messageId: string, reason: string): Promise<void> {
    if (!this.options.database) return;
    await this.options.database.query(
      `UPDATE recruiter_outreach_messages SET status='FAILED',send_state='FAILED',failure_reason=$2,send_claimed_at=NULL,send_started_at=NULL,updated_at=NOW() WHERE id=$1 AND status='SENDING'`,
      [messageId, reason]
    );
  }
}

export { deterministicMessageId, loadResumeAttachment, resolveResumePath };