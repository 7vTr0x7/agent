import { EmailMessage, EmailSender } from "./Email";
import { EmailNotificationService } from "./EmailNotificationService";

class FakeEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

describe("EmailNotificationService", () => {
  it("creates an idempotent submitted-application notification", async () => {
    const sender = new FakeEmailSender();
    const service = new EmailNotificationService(sender);

    await service.applicationSubmitted({
      recipient: "candidate@example.com",
      candidateName: "Salman",
      jobTitle: "Frontend Engineer",
      companyName: "Example Co",
      applicationId: "application-1",
      confirmationUrl: "https://example.com/success"
    });

    expect(sender.messages).toEqual([
      expect.objectContaining({
        to: "candidate@example.com",
        subject: "Application submitted: Frontend Engineer at Example Co",
        dedupeKey: "application-submitted:application-1"
      })
    ]);
    expect(sender.messages[0]?.text).toContain("https://example.com/success");
  });

  it("creates a manual-review notification without claiming submission", async () => {
    const sender = new FakeEmailSender();
    const service = new EmailNotificationService(sender);

    await service.applicationBlocked({
      recipient: "candidate@example.com",
      candidateName: "Salman",
      jobTitle: "Frontend Engineer",
      companyName: "Example Co",
      applicationId: "application-2",
      reason: "Required work authorization field needs manual review."
    });

    expect(sender.messages[0]).toEqual(
      expect.objectContaining({
        subject: "Manual review required: Frontend Engineer at Example Co",
        dedupeKey: "application-blocked:application-2"
      })
    );
    expect(sender.messages[0]?.text).toContain("No application was submitted automatically.");
  });
});
