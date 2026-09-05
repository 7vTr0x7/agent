import { chromium } from "playwright";
import { SubmissionButtonResolver } from "./SubmissionButtonResolver";

describe("SubmissionButtonResolver", () => {
  it("resolves exactly one visible enabled submit button", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.setContent(`
        <form>
          <button type="button">Cancel</button>
          <button type="submit">Submit Application</button>
        </form>
      `);

      const result = await new SubmissionButtonResolver().resolveVerified(page);

      expect(result.found).toBe(true);
      expect(result.reason).toBe("A unique visible and enabled submit button was verified.");
      expect(result.locator).not.toBeNull();
      await expectButtonText(result.locator, "Submit Application");
    } finally {
      await browser.close();
    }
  });

  it("refuses to resolve when multiple submit-like buttons exist", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.setContent(`
        <button>Apply Now</button>
        <button>Submit Application</button>
      `);

      const result = await new SubmissionButtonResolver().resolveVerified(page);

      expect(result.found).toBe(false);
      expect(result.locator).toBeNull();
      expect(result.reason).toBe(
        "Multiple possible submit buttons were found; manual review required."
      );
    } finally {
      await browser.close();
    }
  });

  it("refuses disabled submit controls", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.setContent(`<button disabled>Submit</button>`);

      const result = await new SubmissionButtonResolver().resolveVerified(page);

      expect(result.found).toBe(false);
      expect(result.locator).toBeNull();
      expect(result.reason).toBe("The submit button is not visible and enabled.");
    } finally {
      await browser.close();
    }
  });
});

async function expectButtonText(
  locator: import("playwright").Locator | null,
  expected: string
): Promise<void> {
  if (!locator) throw new Error("Expected a resolved submit button.");
  await expect(locator.innerText()).resolves.toBe(expected);
}
