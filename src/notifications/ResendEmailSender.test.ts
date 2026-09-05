import { ResendEmailSender } from "./ResendEmailSender";

describe("ResendEmailSender", () => {
  it("sends the expected request payload", async () => {
    const fetchImpl: typeof fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "Job Agent <noreply@example.com>",
      fetchImpl
    });

    await sender.send({
      to: "candidate@example.com",
      subject: "Application submitted",
      text: "Your application was submitted.",
      dedupeKey: "application-submitted:application-1"
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer re_test_key",
        "Idempotency-Key": "application-submitted:application-1"
      }),
      body: JSON.stringify({
        from: "Job Agent <noreply@example.com>",
        to: ["candidate@example.com"],
        subject: "Application submitted",
        text: "Your application was submitted."
      })
    }));
  });

  it("throws when the provider rejects the request", async () => {
    const fetchImpl: typeof fetch = jest.fn().mockResolvedValue(
      new Response("invalid api key", { status: 401 })
    );

    const sender = new ResendEmailSender({
      apiKey: "re_invalid",
      from: "Job Agent <noreply@example.com>",
      fetchImpl
    });

    await expect(
      sender.send({
        to: "candidate@example.com",
        subject: "Test",
        text: "Test"
      })
    ).rejects.toThrow("Email provider returned HTTP 401: invalid api key");
  });
});
