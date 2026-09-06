import { chromium, Browser, Page } from "playwright";
import { SmartRecruitersApplicationAdapter } from "./SmartRecruitersApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("SmartRecruitersApplicationAdapter", () => {
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
    url: "https://jobs.smartrecruiters.com/ExampleCompany/123-job"
  };

  it("recognizes SmartRecruiters-hosted application URLs only", () => {
    const adapter = new SmartRecruitersApplicationAdapter();

    expect(adapter.canHandle("https://jobs.smartrecruiters.com/ExampleCompany/123-job")).toBe(true);
    expect(adapter.canHandle("https://careers.smartrecruiters.com/ExampleCompany")).toBe(true);
    expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("https://smartrecruiters.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified SmartRecruiters submit control and requires confirmation", async () => {
    const adapter = new SmartRecruitersApplicationAdapter();

    await page.setContent(`
      <form>
        <button type="submit" data-testid="submit">Submit</button>
      </form>
      <script>
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "Thank you for applying. Your application has been submitted.";
        });
      </script>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(true);
    expect(result.confirmationUrl).toBe("about:blank");
    expect(result.reason).toContain("confirmation");
  });

  it("refuses to click when multiple possible submit controls are visible", async () => {
    const adapter = new SmartRecruitersApplicationAdapter();

    await page.setContent(`
      <button type="submit" data-testid="submit">Submit</button>
      <button type="submit">Submit Application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });

  it("requires confirmation after a click", async () => {
    const adapter = new SmartRecruitersApplicationAdapter();

    await page.setContent(`
      <button type="submit" data-testid="submit">Submit</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("confirmation could not be verified");
  });
});
