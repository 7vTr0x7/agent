import { EmailMessage, EmailSender } from "./Email";

export interface ResendEmailSenderOptions {
  apiKey: string;
  from: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ResendEmailSender implements EmailSender {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResendEmailSenderOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.resend.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        ...(message.dedupeKey ? { "Idempotency-Key": message.dedupeKey } : {})
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Email provider returned HTTP ${response.status}: ${body}`.trim());
    }
  }
}
