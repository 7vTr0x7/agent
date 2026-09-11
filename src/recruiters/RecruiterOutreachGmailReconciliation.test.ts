import { RecruiterOutreachGmailReconciliation } from "./RecruiterOutreachGmailReconciliation";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { GmailMailbox } from "../email/GmailMailbox";

function database(rows: unknown[], queryImpl?: jest.Mock): any {
  return { query: queryImpl ?? jest.fn().mockResolvedValue({ rows }) };
}

describe("RecruiterOutreachGmailReconciliation", () => {
  it("reconciles an accepted message by deterministic RFC Message-ID", async () => {
    const db = database([{
      id: "message-1", status: "SENDING", send_state: "AMBIGUOUS", client_message_id: "<recruiter-outreach-message-1@job-agent.local>",
      recipient_email: "recruiter@acme.dev", subject: "Application for Frontend Engineer at Acme", sequence_id: "sequence-1",
      sequence_status: "ACTIVE", job_opportunity_id: "job-1", contact_email: "recruiter@acme.dev"
    }]);
    const mailbox: GmailMailbox = {
      listMessages: jest.fn().mockResolvedValue(["gmail-1"]),
      getMessage: jest.fn().mockResolvedValue({ gmailMessageId: "gmail-1", gmailThreadId: "thread-1", rfcMessageId: "<recruiter-outreach-message-1@job-agent.local>", inReplyTo: null, senderEmail: "me@acme.dev", senderName: "Candidate", recipientEmail: "recruiter@acme.dev", subject: "Application for Frontend Engineer at Acme", receivedAt: new Date(), snippet: null, bodyText: "Hi", classification: "OTHER" }),
      sendMessage: jest.fn()
    };
    const repository = { markOutreachMessageSent: jest.fn().mockResolvedValue(undefined) } as unknown as RecruiterDiscoveryRepository;
    const service = new RecruiterOutreachGmailReconciliation(db, mailbox, repository);
    await expect(service.reconcile("message-1")).resolves.toEqual({ status: "FOUND", messageId: "message-1", gmailMessageId: "gmail-1", gmailThreadId: "thread-1" });
    expect(mailbox.sendMessage).not.toHaveBeenCalled();
    expect(repository.markOutreachMessageSent).toHaveBeenCalledWith("message-1", { provider: "gmail", providerMessageId: "gmail-1", providerThreadId: "thread-1" });
  });

  it("does not retry when exact deterministic reconciliation finds nothing", async () => {
    const db = database([{
      id: "message-1", status: "SENDING", send_state: "AMBIGUOUS", client_message_id: "<recruiter-outreach-message-1@job-agent.local>",
      recipient_email: "recruiter@acme.dev", subject: "Application for Frontend Engineer at Acme", sequence_id: "sequence-1",
      sequence_status: "ACTIVE", job_opportunity_id: "job-1", contact_email: "recruiter@acme.dev"
    }]);
    const mailbox: GmailMailbox = { listMessages: jest.fn().mockResolvedValue([]), getMessage: jest.fn(), sendMessage: jest.fn() };
    const repository = { markOutreachMessageSent: jest.fn() } as unknown as RecruiterDiscoveryRepository;
    const result = await new RecruiterOutreachGmailReconciliation(db, mailbox, repository).reconcile("message-1");
    expect(result.status).toBe("INCONCLUSIVE");
    expect(mailbox.sendMessage).not.toHaveBeenCalled();
    expect(repository.markOutreachMessageSent).not.toHaveBeenCalled();
  });

  it("refuses to reconcile a normal prepared record", async () => {
    const db = database([{ id: "message-1", status: "PREPARED", send_state: "READY" }]);
    const mailbox: GmailMailbox = { listMessages: jest.fn(), getMessage: jest.fn(), sendMessage: jest.fn() };
    const repository = { markOutreachMessageSent: jest.fn() } as unknown as RecruiterDiscoveryRepository;
    await expect(new RecruiterOutreachGmailReconciliation(db, mailbox, repository).reconcile("message-1")).resolves.toMatchObject({ status: "NOT_ELIGIBLE" });
    expect(mailbox.listMessages).not.toHaveBeenCalled();
  });
});
