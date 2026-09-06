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

export class RecruiterOutreachInboundProcessor {
  constructor(private readonly repository: RecruiterInboundRepository) {}

  async process(message: GmailMessage): Promise<RecruiterInboundOutcome> {
    if (!message.senderEmail) return { status: "IGNORED", reason: "Inbound message has no sender email." };

    const sequence = await this.repository.findActiveOutreachSequenceByProviderMessage(
      message.gmailMessageId,
      message.gmailThreadId,
      message.rfcMessageId,
      message.inReplyTo
    );
    if (!sequence) return { status: "IGNORED", reason: "Message is not linked to an active recruiter outreach sequence." };

    const content = `${message.subject}\n${message.bodyText}`.toLowerCase();
    if (isOptOut(content)) {
      await this.repository.suppressRecruiterEmail(message.senderEmail, "OPTOUT", "gmail-reply");
      await this.repository.stopOutreachSequence(sequence.sequenceId, "Recruiter opted out of further outreach.");
      return { status: "OPTOUT_SUPPRESSED", sequenceId: sequence.sequenceId };
    }

    if (isBounce(content)) {
      await this.repository.suppressRecruiterEmail(message.senderEmail, "BOUNCE", "gmail-bounce");
      await this.repository.stopOutreachSequence(sequence.sequenceId, "Delivery failure/bounce received.");
      return { status: "BOUNCE_SUPPRESSED", sequenceId: sequence.sequenceId };
    }

    await this.repository.stopOutreachSequence(sequence.sequenceId, "Recruiter replied; follow-ups stopped.");
    return { status: "REPLY_STOPPED", sequenceId: sequence.sequenceId };
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
