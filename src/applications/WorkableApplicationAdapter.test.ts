import { chromium, Browser, Page } from "playwright";
import { WorkableApplicationAdapter } from "./WorkableApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("WorkableApplicationAdapter", () => {
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
    url: "https://apply.workable.com/example-company/j/123-job/"
  };

  it("recognizes Workable-hosted application URLs only", () => {
    const adapter = new WorkableApplicationAdapter();

    expect(adapter.canHandle("https://apply.workable.com/example-company/j/123-job/")).toBe(true);
    expect(adapter.canHandle("https://jobs.workable.com/example-company/job/123")).toBe(true);
    expect(adapter.canHandle("https://acme.workable.com/jobs/123")).toBe(true);
    expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("https://workable.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified Workable submit control and requires confirmation", async () => {
    const adapter = new WorkableApplicationAdapter();

    await page.setContent(`
      <form>
        <button type="submit" data-testid="submit">Submit Application</button>
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
    const adapter = new WorkableApplicationAdapter();

    await page.setContent(`
      <button type="submit" data-testid="submit">Submit</button>
      <button type="submit">Submit Application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });

  it("requires confirmation after a click", async () => {
    const adapter = new WorkableApplicationAdapter();

    await page.setContent(`
      <button type="submit" data-testid="submit">Submit</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("confirmation could not be verified");
  });
});
