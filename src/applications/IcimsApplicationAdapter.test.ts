import { chromium, Browser, Page } from "playwright";
import { IcimsApplicationAdapter } from "./IcimsApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("IcimsApplicationAdapter", () => {
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
    url: "https://careers-example.icims.com/jobs/123/frontend-engineer/job"
  };

  it("recognizes iCIMS-hosted application URLs only", () => {
    const adapter = new IcimsApplicationAdapter();

    expect(adapter.canHandle("https://careers.icims.com/careers-home")).toBe(true);
    expect(adapter.canHandle("https://careers-example.icims.com/jobs/123/frontend-engineer/job")).toBe(true);
    expect(adapter.canHandle("https://example.icims.com/jobs/123")).toBe(true);
    expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("https://icims.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified iCIMS submit control and requires confirmation", async () => {
    const adapter = new IcimsApplicationAdapter();

    await page.setContent(`
      <form>
        <button type="submit" data-testid="submit">Submit</button>
      </form>
      <script>
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "Thank you for applying. Your application was submitted successfully.";
        });
      </script>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(true);
    expect(result.confirmationUrl).toBe("about:blank");
    expect(result.reason).toContain("confirmation");
  });

  it("refuses to click when multiple possible submit controls are visible", async () => {
    const adapter = new IcimsApplicationAdapter();

    await page.setContent(`
      <button type="submit" data-testid="submit">Submit</button>
      <button type="submit">Submit Application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });

  it("requires confirmation after a click", async () => {
    const adapter = new IcimsApplicationAdapter();

    await page.setContent(`
      <button type="submit" data-testid="submit">Submit</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("confirmation could not be verified");
  });
});
