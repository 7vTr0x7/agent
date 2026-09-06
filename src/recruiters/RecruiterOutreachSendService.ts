import { GmailMailbox } from "../email/GmailMailbox";
import {
  RecruiterDiscoveryRepository,
  RecruiterOutreachMessageRecord
} from "./RecruiterDiscoveryRepository";

export interface RecruiterOutreachSendOptions {
  repository: RecruiterDiscoveryRepository;
  mailbox: GmailMailbox;
  dryRun?: boolean;
  maxMessagesPerDay?: number;
  maxMessagesPerHour?: number;
}

export type RecruiterOutreachSendResult =
  | { status: "DRY_RUN"; messageId: string }
  | { status: "SENT"; messageId: string; gmailMessageId: string; gmailThreadId: string }
  | { status: "SKIPPED"; messageId: string; reason: string };

export class RecruiterOutreachSendService {
  private readonly dryRun: boolean;
  private readonly maxMessagesPerDay: number;
  private readonly maxMessagesPerHour: number;

  constructor(private readonly options: RecruiterOutreachSendOptions) {
    this.dryRun = options.dryRun ?? true;
    this.maxMessagesPerDay = options.maxMessagesPerDay ?? 20;
    this.maxMessagesPerHour = options.maxMessagesPerHour ?? 5;
    if (!Number.isInteger(this.maxMessagesPerDay) || this.maxMessagesPerDay < 1) {
      throw new Error("Recruiter daily send limit must be a positive integer.");
    }
    if (!Number.isInteger(this.maxMessagesPerHour) || this.maxMessagesPerHour < 1) {
      throw new Error("Recruiter hourly send limit must be a positive integer.");
    }
  }

  async send(message: RecruiterOutreachMessageRecord, companyDomain: string): Promise<RecruiterOutreachSendResult> {
    if (message.status !== "PREPARED") {
      return { status: "SKIPPED", messageId: message.id, reason: `Message is not PREPARED (status=${message.status}).` };
    }

    const suppression = await this.options.repository.isSuppressed(message.recipientEmail, companyDomain);
    if (suppression.email || suppression.domain) {
      return { status: "SKIPPED", messageId: message.id, reason: suppression.email ? "Recipient is suppressed." : "Company domain is suppressed." };
    }

    if (this.dryRun) {
      return { status: "DRY_RUN", messageId: message.id };
    }

    const now = Date.now();
    const dayCount = await this.options.repository.countSentOutreachMessagesSince(new Date(now - 24 * 60 * 60 * 1000));
    if (dayCount >= this.maxMessagesPerDay) {
      return { status: "SKIPPED", messageId: message.id, reason: "Daily recruiter outreach send limit reached." };
    }

    const hourCount = await this.options.repository.countSentOutreachMessagesSince(new Date(now - 60 * 60 * 1000));
    if (hourCount >= this.maxMessagesPerHour) {
      return { status: "SKIPPED", messageId: message.id, reason: "Hourly recruiter outreach send limit reached." };
    }

    const claimed = await this.options.repository.claimPreparedOutreachMessage(message.id);
    if (!claimed) {
      return { status: "SKIPPED", messageId: message.id, reason: "Message was already claimed or is no longer sendable." };
    }

    try {
      const sent = await this.options.mailbox.sendMessage({
        to: claimed.recipientEmail,
        subject: claimed.subject,
        bodyText: claimed.body
      });
      await this.options.repository.markOutreachMessageSent(claimed.id, {
        provider: "gmail",
        providerMessageId: sent.gmailMessageId,
        providerThreadId: sent.gmailThreadId
      });
      return { status: "SENT", messageId: claimed.id, gmailMessageId: sent.gmailMessageId, gmailThreadId: sent.gmailThreadId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.options.repository.markOutreachMessageFailed(claimed.id, reason);
      throw error;
    }
  }
}
