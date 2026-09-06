import { chromium, Browser, Page } from "playwright";
import { GreenhouseApplicationAdapter } from "./GreenhouseApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("GreenhouseApplicationAdapter", () => {
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
    url: "https://boards.greenhouse.io/example/jobs/123"
  };

  it("recognizes Greenhouse-hosted application URLs only", () => {
    const adapter = new GreenhouseApplicationAdapter();

    expect(adapter.canHandle("https://boards.greenhouse.io/example/jobs/123")).toBe(true);
    expect(adapter.canHandle("https://job-boards.greenhouse.io/example/jobs/123")).toBe(true);
    expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified Greenhouse submit control and requires confirmation", async () => {
    const adapter = new GreenhouseApplicationAdapter();

    await page.setContent(`
      <form>
        <button id="submit_app" type="submit">Submit Application</button>
      </form>
      <script>
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "Application has been submitted";
        });
      </script>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(true);
    expect(result.confirmationUrl).toBe("about:blank");
    expect(result.reason).toContain("confirmation");
  });

  it("refuses to click when multiple possible submit controls are visible", async () => {
    const adapter = new GreenhouseApplicationAdapter();

    await page.setContent(`
      <button type="submit">Submit Application</button>
      <button type="submit">Submit Application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });
});
