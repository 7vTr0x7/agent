import { GmailMailbox } from "../email/GmailMailbox";
import { Database } from "../database/Database";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachSendReconciliationService } from "./RecruiterOutreachSendReconciliationService";
import { deterministicMessageId } from "./RecruiterOutreachSendService";

describe("RecruiterOutreachSendReconciliationService",()=>{
 it("reconciles a stale SENDING message only when its deterministic Message-ID is found",async()=>{
  const messageId="message-123";
  const database={query:jest.fn().mockResolvedValue({rows:[{id:messageId,recipientEmail:"recruiter@example.com",subject:"Frontend Engineer",sendClaimedAt:new Date()}]})} as unknown as Database;
  const repository={markOutreachMessageSent:jest.fn().mockResolvedValue(undefined)} as unknown as RecruiterDiscoveryRepository;
  const mailbox={listMessages:jest.fn().mockResolvedValue(["gmail-123"]),getMessage:jest.fn().mockResolvedValue({gmailMessageId:"gmail-123",gmailThreadId:"thread-123",rfcMessageId:deterministicMessageId(messageId),inReplyTo:null,senderEmail:"me@example.com",senderName:null,recipientEmail:"recruiter@example.com",subject:"Frontend Engineer",receivedAt:new Date(),snippet:null,bodyText:"Hello",classification:"OTHER"})} as unknown as GmailMailbox;
  const service=new RecruiterOutreachSendReconciliationService(database,repository,mailbox);
  await expect(service.runOnce()).resolves.toEqual({inspected:1,reconciled:1,unresolved:0});
  expect(repository.markOutreachMessageSent).toHaveBeenCalledWith(messageId,{provider:"gmail",providerMessageId:"gmail-123",providerThreadId:"thread-123"});
 });
 it("leaves an unmatched stale message unresolved instead of retrying it",async()=>{
  const database={query:jest.fn().mockResolvedValue({rows:[{id:"message-456",recipientEmail:"recruiter@example.com",subject:"Frontend Engineer",sendClaimedAt:new Date()}]})} as unknown as Database;
  const repository={markOutreachMessageSent:jest.fn()} as unknown as RecruiterDiscoveryRepository;
  const mailbox={listMessages:jest.fn().mockResolvedValue(["gmail-456"]),getMessage:jest.fn().mockResolvedValue({gmailMessageId:"gmail-456",gmailThreadId:"thread-456",rfcMessageId:"<some-other-message@job-agent.local>",inReplyTo:null,senderEmail:"me@example.com",senderName:null,recipientEmail:"recruiter@example.com",subject:"Frontend Engineer",receivedAt:new Date(),snippet:null,bodyText:"Hello",classification:"OTHER"})} as unknown as GmailMailbox;
  const service=new RecruiterOutreachSendReconciliationService(database,repository,mailbox);
  await expect(service.runOnce()).resolves.toEqual({inspected:1,reconciled:0,unresolved:1});
  expect(repository.markOutreachMessageSent).not.toHaveBeenCalled();
 });
});
