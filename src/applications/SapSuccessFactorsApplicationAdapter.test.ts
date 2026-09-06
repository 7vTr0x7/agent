import { chromium, Browser, Page } from "playwright";
import { SapSuccessFactorsApplicationAdapter } from "./SapSuccessFactorsApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("SapSuccessFactorsApplicationAdapter", () => {
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
    url: "https://career8.successfactors.com/sfcareer/jobreqcareer?jobId=123&company=example"
  };

  it("recognizes SAP SuccessFactors career URLs only", () => {
    const adapter = new SapSuccessFactorsApplicationAdapter();

    expect(
      adapter.canHandle(
        "https://career8.successfactors.com/sfcareer/jobreqcareer?jobId=123&company=example"
      )
    ).toBe(true);
    expect(
      adapter.canHandle(
        "https://example.hcm.ondemand.com/career?company=example&jobId=123"
      )
    ).toBe(true);
    expect(
      adapter.canHandle(
        "https://career8.successfactors.com/career?career_ns=job_listing&company=example"
      )
    ).toBe(true);
    expect(adapter.canHandle("https://successfactors.com/" )).toBe(false);
    expect(adapter.canHandle("https://example.com/career/jobs/123")).toBe(false);
    expect(adapter.canHandle("http://career8.successfactors.com/sfcareer/jobreqcareer?jobId=123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified Apply control and requires confirmation", async () => {
    const adapter = new SapSuccessFactorsApplicationAdapter();

    await page.setContent(`
      <form>
        <button type="submit" id="apply">Apply</button>
      </form>
      <script>
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "Your application has been sent. Thank you for applying.";
        });
      </script>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(true);
    expect(result.confirmationUrl).toBe("about:blank");
    expect(result.reason).toContain("confirmation");
  });

  it("refuses to click when multiple possible Apply controls are visible", async () => {
    const adapter = new SapSuccessFactorsApplicationAdapter();

    await page.setContent(`
      <button type="submit" id="apply">Apply</button>
      <button type="button">Apply</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });

  it("requires confirmation after a click", async () => {
    const adapter = new SapSuccessFactorsApplicationAdapter();

    await page.setContent(`
      <button type="submit" id="apply">Apply</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("confirmation could not be verified");
  });
});
