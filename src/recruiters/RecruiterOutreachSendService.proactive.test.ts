import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";

test("allows proactive recruiter campaign through automation gate when no job is linked", async () => {
  const repository = {
    getOutreachSequence: jest.fn().mockResolvedValue({ id: "seq", recruiterContactId: "contact", jobOpportunityId: null, applicationId: null, candidateProfileId: "candidate", status: "READY", nextActionAt: null, followUpCount: 0 }),
    isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false })
  } as any;
  const service = new RecruiterOutreachSendService({ repository, dryRun: false, outboundEnabled: false, gmailEnabled: true, automationEnabled: true, activation: "canary", liveActivationConfirmed: true, controlledSendConfirmation: "CONTROLLED_SEND_CONFIRMATION", controlledMessageId: "message-1", controlledRecipient: "recruiter@acme.dev" });
  const result = await service.send({ id: "message-1", sequenceId: "seq", messageType: "INITIAL", sequenceStep: 0, recipientEmail: "recruiter@acme.dev", subject: "Test", body: "Test", status: "PREPARED" }, "acme.dev");
  expect(result).toMatchObject({ status: "SKIPPED", reason: "Global outbound kill switch is disabled." });
});
