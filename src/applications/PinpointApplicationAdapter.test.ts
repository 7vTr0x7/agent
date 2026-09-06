import { chromium, Browser, Page } from "playwright";
import { PinpointApplicationAdapter } from "./PinpointApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("PinpointApplicationAdapter", () => {
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
    url: "https://example.pinpointhq.com/postings/123"
  };

  it("recognizes Pinpoint hosted application URLs only", () => {
    const adapter = new PinpointApplicationAdapter();

    expect(adapter.canHandle("https://example.pinpointhq.com/postings/123")).toBe(true);
    expect(adapter.canHandle("https://icario.pinpointhq.com/postings/54bf384b-d5a0-4c7e-aa4f-970ac06348fa")).toBe(true);
    expect(adapter.canHandle("https://workwithus.pinpointhq.com/register-your-interest/new")).toBe(true);
    expect(adapter.canHandle("https://pinpointhq.com/postings/123")).toBe(true);
    expect(adapter.canHandle("https://example.pinpointhq.com/about")).toBe(false);
    expect(adapter.canHandle("https://example.com/postings/123")).toBe(false);
    expect(adapter.canHandle("http://example.pinpointhq.com/postings/123")).toBe(false);
    expect(adapter.canHandle("not-a-url")).toBe(false);
  });

  it("clicks one verified Pinpoint submit control and requires confirmation", async () => {
    const adapter = new PinpointApplicationAdapter();

    await page.setContent(`
      <form>
        <button type="submit" name="submit">Submit</button>
      </form>
      <script>
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "Application received. Thank you for applying.";
        });
      </script>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(true);
    expect(result.confirmationUrl).toBe("about:blank");
    expect(result.reason).toContain("confirmation");
  });

  it("refuses to click when multiple possible submit controls are visible", async () => {
    const adapter = new PinpointApplicationAdapter();

    await page.setContent(`
      <button type="submit" name="submit">Submit</button>
      <button type="submit">Submit Application</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("manual review");
  });

  it("requires confirmation after a click", async () => {
    const adapter = new PinpointApplicationAdapter();

    await page.setContent(`
      <button type="submit" name="submit">Submit</button>
    `);

    const result = await adapter.submit(page, context);

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("confirmation could not be verified");
  });
});
