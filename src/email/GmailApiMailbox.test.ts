import { GmailApiMailbox } from "./GmailApiMailbox";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("GmailApiMailbox", () => {
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("access-token") } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retries transient listMessages failures", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, { messages: [{ id: "message-1" }] }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({
      oauth,
      userEmail: "candidate@example.com",
      fetchImpl,
      retryDelayMs: 10,
      sleepImpl
    });

    await expect(mailbox.listMessages("newer_than:1d", 10)).resolves.toEqual(["message-1"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(10);
  });

  it("honors Retry-After for rate-limited getMessage calls", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(429, {}, { "Retry-After": "2" }))
      .mockResolvedValueOnce(response(200, {
        id: "message-1",
        threadId: "thread-1",
        payload: {
          headers: [
            { name: "From", value: "Recruiter <recruiter@example.com>" },
            { name: "Subject", value: "Frontend Engineer" }
          ],
          mimeType: "text/plain",
          body: { data: Buffer.from("Hello").toString("base64url") }
        }
      }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({
      oauth,
      userEmail: "candidate@example.com",
      fetchImpl,
      retryDelayMs: 10,
      sleepImpl
    });

    await expect(mailbox.getMessage("message-1")).resolves.toMatchObject({
      gmailMessageId: "message-1",
      gmailThreadId: "thread-1",
      senderEmail: "recruiter@example.com"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it("does not retry sendMessage after a transient failure", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(503, {}));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({
      oauth,
      userEmail: "candidate@example.com",
      fetchImpl,
      retryDelayMs: 10,
      sleepImpl
    });

    await expect(mailbox.sendMessage({
      to: "recruiter@example.com",
      subject: "Frontend Engineer",
      bodyText: "Hello"
    })).rejects.toThrow("Gmail API request failed (503)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("does not retry permanent GET failures", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(401, {}));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({
      oauth,
      userEmail: "candidate@example.com",
      fetchImpl,
      sleepImpl
    });

    await expect(mailbox.listMessages("newer_than:1d", 10)).rejects.toThrow("Gmail API request failed (401)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});
