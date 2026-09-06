import { GmailMessage } from "../email/GmailMailbox";
import { RecruiterInboundRepository, RecruiterOutreachInboundProcessor } from "./RecruiterOutreachInboundProcessor";

function message(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    gmailMessageId: "incoming-1",
    gmailThreadId: "thread-1",
    rfcMessageId: "<incoming@example.com>",
    inReplyTo: "<sent@example.com>",
    senderEmail: "recruiter@company.com",
    senderName: "Recruiter",
    recipientEmail: "candidate@example.com",
    subject: "Re: Frontend Engineer",
    receivedAt: new Date(),
    snippet: "Thanks",
    bodyText: "Thanks for reaching out.",
    classification: "OTHER",
    ...overrides
  };
}

function repository(
  sequence: { sequenceId: string; recipientEmail: string; companyDomain: string } | null = {
    sequenceId: "sequence-1",
    recipientEmail: "recruiter@company.com",
    companyDomain: "company.com"
  }
): RecruiterInboundRepository & { stopped: string[]; suppressed: string[] } {
  const stopped: string[] = [];
  const suppressed: string[] = [];
  return {
    stopped,
    suppressed,
    async findActiveOutreachSequenceByProviderMessage() { return sequence; },
    async stopOutreachSequence(sequenceId) { stopped.push(sequenceId); },
    async suppressRecruiterEmail(email) { suppressed.push(email); }
  };
}

describe("RecruiterOutreachInboundProcessor", () => {
  it("stops an active sequence when a recruiter replies", async () => {
    const repo = repository();
    const result = await new RecruiterOutreachInboundProcessor(repo).process(message());
    expect(result).toEqual({ status: "REPLY_STOPPED", sequenceId: "sequence-1" });
    expect(repo.stopped).toEqual(["sequence-1"]);
    expect(repo.suppressed).toEqual([]);
  });

  it("suppresses and stops when the recruiter opts out", async () => {
    const repo = repository();
    const result = await new RecruiterOutreachInboundProcessor(repo).process(message({ bodyText: "Please unsubscribe me and do not contact me again." }));
    expect(result).toEqual({ status: "OPTOUT_SUPPRESSED", sequenceId: "sequence-1" });
    expect(repo.suppressed).toEqual(["recruiter@company.com"]);
    expect(repo.stopped).toEqual(["sequence-1"]);
  });

  it("suppresses and stops on a clear bounce notification", async () => {
    const repo = repository();
    const result = await new RecruiterOutreachInboundProcessor(repo).process(message({
      senderEmail: "mailer-daemon@company.com",
      subject: "Mail delivery failed: Frontend Engineer",
      bodyText: "Delivery failure. The recipient address was rejected."
    }));
    expect(result).toEqual({ status: "BOUNCE_SUPPRESSED", sequenceId: "sequence-1" });
    expect(repo.suppressed).toEqual(["mailer-daemon@company.com"]);
    expect(repo.stopped).toEqual(["sequence-1"]);
  });

  it("ignores unrelated Gmail messages", async () => {
    const repo = repository(null);
    const result = await new RecruiterOutreachInboundProcessor(repo).process(message());
    expect(result.status).toBe("IGNORED");
    expect(repo.stopped).toEqual([]);
    expect(repo.suppressed).toEqual([]);
  });

  it("ignores messages without a sender", async () => {
    const repo = repository();
    const result = await new RecruiterOutreachInboundProcessor(repo).process(message({ senderEmail: null }));
    expect(result).toEqual({ status: "IGNORED", reason: "Inbound message has no sender email." });
    expect(repo.stopped).toEqual([]);
  });
});
