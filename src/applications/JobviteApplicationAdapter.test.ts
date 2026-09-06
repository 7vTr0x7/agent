import { chromium, Browser, Page } from "playwright";
import { JobviteApplicationAdapter } from "./JobviteApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("JobviteApplicationAdapter", () => {
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
    url: "https://jobs.jobvite.com/example/job/123"
  };

  it("recognizes Jobvite-hosted application URLs only", () => {
    const adapter = new JobviteApplicationAdapter();

    expect(adapter.canHandle("https://jobs.jobvite.com/example/job/123")).toBe(true);
    expect(adapter.canHandle("https://careers.jobvite.com/example/jobs/123")).toBe(true);
    expect(adapter.canHandle("https://app.jobvite.com/CompanyJobs/Careers.aspx?c=abc")).toBe(true);
    expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("https://jobvite.com/jobs/123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified Jobvite submit control and requires confirmation", async () => {
    const adapter = new JobviteApplicationAdapter();

    await page.setContent(`
      <form>
        <button type="submit" name="submit">Submit Application</button>
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
    const adapter = new JobviteApplicationAdapter();

    await page.setContent(`
      <button type="submit" name="submit">Submit</button>
      <button type="submit">Submit Application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });

  it("requires confirmation after a click", async () => {
    const adapter = new JobviteApplicationAdapter();

    await page.setContent(`
      <button type="submit" name="submit">Submit</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("confirmation could not be verified");
  });
});
