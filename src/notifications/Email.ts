export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  dedupeKey?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface ApplicationEmailContext {
  recipient: string;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  applicationId: string;
  confirmationUrl?: string | null;
  reason?: string;
}
