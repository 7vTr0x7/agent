export type GmailClassification =
  | "APPLICATION_CONFIRMATION"
  | "INTERVIEW"
  | "POSITIVE"
  | "REJECTION"
  | "OTHER";

export interface GmailMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  senderEmail: string | null;
  senderName: string | null;
  recipientEmail: string | null;
  subject: string;
  receivedAt: Date | null;
  snippet: string | null;
  bodyText: string;
  classification: GmailClassification;
}

export interface GmailMailbox {
  listMessages(query: string, maxResults?: number): Promise<readonly string[]>;
  getMessage(messageId: string): Promise<GmailMessage>;
  sendMessage(message: {
    to: string;
    subject: string;
    bodyText: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ gmailMessageId: string; gmailThreadId: string }>;
}
