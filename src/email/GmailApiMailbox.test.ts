import { GmailApiMailbox, buildMimeMessage } from "./GmailApiMailbox";
import type { GmailOAuthClient } from "./GmailOAuthClient";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("GmailApiMailbox", () => {
  const oauth = {
    getAccessToken: jest.fn().mockResolvedValue("access-token"),
    invalidateAccessToken: jest.fn()
  } as unknown as GmailOAuthClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retries transient listMessages failures", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, { messages: [{ id: "message-1" }] }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({ oauth, userEmail: "candidate@example.com", fetchImpl, retryDelayMs: 10, sleepImpl });
    await expect(mailbox.listMessages("newer_than:1d", 10)).resolves.toEqual(["message-1"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(10);
  });

  it("honors Retry-After for rate-limited getMessage calls", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(429, {}, { "Retry-After": "2" }))
      .mockResolvedValueOnce(response(200, { id: "message-1", threadId: "thread-1", payload: { headers: [{ name: "From", value: "Recruiter <recruiter@example.com>" }, { name: "Subject", value: "Frontend Engineer" }], mimeType: "text/plain", body: { data: Buffer.from("Hello").toString("base64url") } } }));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({ oauth, userEmail: "candidate@example.com", fetchImpl, retryDelayMs: 10, sleepImpl });
    await expect(mailbox.getMessage("message-1")).resolves.toMatchObject({ gmailMessageId: "message-1", gmailThreadId: "thread-1", senderEmail: "recruiter@example.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it("refreshes the access token once after a 401", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { messages: [{ id: "message-1" }] }));
    const mailbox = new GmailApiMailbox({ oauth, userEmail: "candidate@example.com", fetchImpl });
    await expect(mailbox.listMessages("newer_than:1d", 10)).resolves.toEqual(["message-1"]);
    expect(oauth.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends a multipart MIME message containing the resume attachment", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { id: "gmail-1", threadId: "thread-1" }));
    const mailbox = new GmailApiMailbox({ oauth, userEmail: "candidate@example.com", fetchImpl });
    await expect(mailbox.sendMessage({
      to: "recruiter@example.com",
      subject: "Frontend Engineer",
      bodyText: "Please find my resume attached.",
      attachments: [{ filename: "Salman_Shaikh_FE.pdf", contentType: "application/pdf", content: Buffer.from("pdf-bytes") }]
    })).resolves.toEqual({ gmailMessageId: "gmail-1", gmailThreadId: "thread-1" });
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { raw: string };
    const decoded = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toContain("multipart/mixed");
    expect(decoded).toContain("filename=\"Salman_Shaikh_FE.pdf\"");
    expect(decoded).toContain(Buffer.from("pdf-bytes").toString("base64"));
  });

  it("does not retry sendMessage after a transient failure", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(503, {}));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({ oauth, userEmail: "candidate@example.com", fetchImpl, retryDelayMs: 10, sleepImpl });
    await expect(mailbox.sendMessage({ to: "recruiter@example.com", subject: "Frontend Engineer", bodyText: "Hello" })).rejects.toThrow("Gmail API request failed (503)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("does not retry permanent GET failures after the single token-refresh attempt", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(401, {}));
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const mailbox = new GmailApiMailbox({ oauth, userEmail: "candidate@example.com", fetchImpl, sleepImpl });
    await expect(mailbox.listMessages("newer_than:1d", 10)).rejects.toThrow("Gmail API request failed (401)");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(oauth.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("builds a plain text message without multipart when no attachment exists", () => {
    const mime = buildMimeMessage({ to: "recruiter@example.com", subject: "Hello", bodyText: "Body" }, "candidate@example.com");
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).not.toContain("multipart/mixed");
  });
});
