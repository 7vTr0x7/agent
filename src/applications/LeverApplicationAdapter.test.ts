import { chromium, Browser, Page } from "playwright";
import { LeverApplicationAdapter } from "./LeverApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("LeverApplicationAdapter", () => {
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterEach(async () => {
    await browser.close();
  });

  const context: ApplicationContext = {
    jobOpportunityId: "job-1",
    candidateProfileId: "candidate-1",
    applicationId: "application-1",
    url: "https://jobs.lever.co/example/123/apply"
  };

  it("recognizes Lever-hosted application URLs only", () => {
    const adapter = new LeverApplicationAdapter();

    expect(adapter.canHandle("https://jobs.lever.co/example/123/apply")).toBe(true);
    expect(adapter.canHandle("https://example.lever.co/jobs/123/apply")).toBe(true);
    expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified Lever submit control and requires confirmation", async () => {
    const adapter = new LeverApplicationAdapter();

    await page.setContent(`
      <form>
        <button type="submit">Submit application</button>
      </form>
      <script>
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "Thanks for applying! Your application has been submitted.";
        });
      </script>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(true);
    expect(result.confirmationUrl).toBe("about:blank");
    expect(result.reason).toContain("confirmation");
  });

  it("refuses to click when multiple possible submit controls are visible", async () => {
    const adapter = new LeverApplicationAdapter();

    await page.setContent(`
      <button type="submit">Submit application</button>
      <button type="submit">Submit application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });

  it("requires confirmation after a click", async () => {
    const adapter = new LeverApplicationAdapter();

    await page.setContent(`
      <button type="submit">Submit application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("confirmation could not be verified");
  });
});
