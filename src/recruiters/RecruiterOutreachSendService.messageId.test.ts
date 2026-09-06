import { deterministicMessageId } from "./RecruiterOutreachSendService";

describe("deterministicMessageId",()=>{
 it("produces a stable RFC Message-ID for the same durable message id",()=>{
  expect(deterministicMessageId("abc-123")).toBe("<recruiter-outreach-abc-123@job-agent.local>");
  expect(deterministicMessageId("abc-123")).toBe(deterministicMessageId("abc-123"));
 });
});
