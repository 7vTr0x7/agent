import { BrowserConfirmationEvidenceVerifier } from "./BrowserConfirmationEvidenceVerifier";
import { BrowserSession } from "./BrowserSession";
import { VerifiedSubmissionEvidence } from "./ApplicationRepository";

describe("BrowserConfirmationEvidenceVerifier", () => {
  const submission = {
    applicationId: "application-1",
    candidateProfileId: "candidate-1",
    companyName: "Example Co",
    targetUrl: "https://jobs.example.com/apply/123",
    startedAt: new Date()
  };

  const evidence: VerifiedSubmissionEvidence = {
    confirmationUrl: "https://jobs.example.com/confirmation/abc",
    externalApplicationId: "APP-123",
    verificationSource: "INDEPENDENT_CONFIRMATION"
  };

  function createBrowserSession(bodyText: string, gotoError?: Error) {
    const page = {
      goto: jest.fn().mockImplementation(async () => {
        if (gotoError) throw gotoError;
      }),
      locator: jest.fn().mockReturnValue({
        innerText: jest.fn().mockResolvedValue(bodyText)
      }),
      setDefaultNavigationTimeout: jest.fn()
    };

    const session = {
      browser: {},
      context: {},
      page
    } as unknown as BrowserSession;

    return { page, session };
  }

  it("verifies an HTTPS confirmation page containing the external ID and confirmation signal", async () => {
    const { page, session } = createBrowserSession(
      "Thank you for applying. Application ID: APP-123"
    );
    const browserSessions = {
      create: jest.fn().mockResolvedValue(session),
      close: jest.fn().mockResolvedValue(undefined)
    };
    const verifier = new BrowserConfirmationEvidenceVerifier(browserSessions as never);

    await expect(verifier.verify(submission, evidence)).resolves.toBe(true);

    expect(page.goto).toHaveBeenCalledWith(evidence.confirmationUrl, { waitUntil: "domcontentloaded" });
    expect(browserSessions.close).toHaveBeenCalledWith(session);
  });

  it("rejects a confirmation page hosted on a different hostname without opening a browser", async () => {
    const browserSessions = {
      create: jest.fn(),
      close: jest.fn()
    };
    const verifier = new BrowserConfirmationEvidenceVerifier(browserSessions as never);

    await expect(verifier.verify(submission, {
      ...evidence,
      confirmationUrl: "https://attacker.example/confirmation/APP-123"
    })).resolves.toBe(false);

    expect(browserSessions.create).not.toHaveBeenCalled();
  });

  it("rejects a confirmation page missing the external application ID", async () => {
    const { session } = createBrowserSession("Thank you for applying.");
    const browserSessions = {
      create: jest.fn().mockResolvedValue(session),
      close: jest.fn().mockResolvedValue(undefined)
    };
    const verifier = new BrowserConfirmationEvidenceVerifier(browserSessions as never);

    await expect(verifier.verify(submission, evidence)).resolves.toBe(false);
  });

  it("rejects a page containing the ID but no confirmation signal", async () => {
    const { session } = createBrowserSession("Application ID: APP-123");
    const browserSessions = {
      create: jest.fn().mockResolvedValue(session),
      close: jest.fn().mockResolvedValue(undefined)
    };
    const verifier = new BrowserConfirmationEvidenceVerifier(browserSessions as never);

    await expect(verifier.verify(submission, evidence)).resolves.toBe(false);
  });

  it("rejects non-HTTPS confirmation URLs without opening a browser", async () => {
    const browserSessions = {
      create: jest.fn(),
      close: jest.fn()
    };
    const verifier = new BrowserConfirmationEvidenceVerifier(browserSessions as never);

    await expect(verifier.verify(submission, {
      ...evidence,
      confirmationUrl: "http://jobs.example.com/confirmation/abc"
    })).resolves.toBe(false);

    expect(browserSessions.create).not.toHaveBeenCalled();
  });

  it("fails closed when confirmation navigation fails", async () => {
    const { session } = createBrowserSession("", new Error("navigation failed"));
    const browserSessions = {
      create: jest.fn().mockResolvedValue(session),
      close: jest.fn().mockResolvedValue(undefined)
    };
    const verifier = new BrowserConfirmationEvidenceVerifier(browserSessions as never);

    await expect(verifier.verify(submission, evidence)).resolves.toBe(false);

    expect(browserSessions.close).toHaveBeenCalledWith(session);
  });
});
