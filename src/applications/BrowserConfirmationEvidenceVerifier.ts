import { BrowserSessionService } from "./BrowserSession";
import { StaleSubmission, VerifiedSubmissionEvidence } from "./ApplicationRepository";
import { SubmissionEvidenceVerifier } from "./StaleSubmissionRecoveryService";

const CONFIRMATION_PATTERNS = [
  /application\s+(?:(?:has\s+been|was|is)\s+)?(?:submitted|received|sent)/i,
  /successfully\s+(?:applied|submitted)/i,
  /thank\s+you\s+for\s+applying/i,
  /thanks\s+for\s+applying/i,
  /application\s+complete/i,
  /application\s+confirmation/i
] as const;

export interface BrowserConfirmationEvidenceVerifierOptions {
  navigationTimeoutMs?: number;
}

/**
 * Verification-only browser check. It never submits a form and requires the
 * independently supplied confirmation URL to be HTTPS and to expose both the
 * external application ID and a recognizable confirmation signal.
 */
export class BrowserConfirmationEvidenceVerifier implements SubmissionEvidenceVerifier {
  constructor(
    private readonly browserSessions: BrowserSessionService,
    private readonly options: BrowserConfirmationEvidenceVerifierOptions = {}
  ) {}

  async verify(
    _submission: StaleSubmission,
    evidence: VerifiedSubmissionEvidence
  ): Promise<boolean> {
    const confirmationUrl = evidence.confirmationUrl.trim();
    const externalApplicationId = evidence.externalApplicationId.trim();

    if (!confirmationUrl || !externalApplicationId) {
      return false;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(confirmationUrl);
    } catch {
      return false;
    }

    if (parsedUrl.protocol !== "https:") {
      return false;
    }

    const session = await this.browserSessions.create();

    try {
      if (this.options.navigationTimeoutMs !== undefined) {
        session.page.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
      }

      await session.page.goto(confirmationUrl, { waitUntil: "domcontentloaded" });
      const text = await session.page.locator("body").innerText();
      const normalizedText = text.replace(/\s+/g, " ").trim();

      const containsApplicationId = normalizedText.includes(externalApplicationId);
      const confirmationSignals = CONFIRMATION_PATTERNS.filter((pattern) =>
        pattern.test(normalizedText)
      ).length;

      return containsApplicationId && confirmationSignals >= 1;
    } catch {
      return false;
    } finally {
      await this.browserSessions.close(session);
    }
  }
}
