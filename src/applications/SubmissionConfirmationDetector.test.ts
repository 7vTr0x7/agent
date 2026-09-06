import http from "node:http";
import { AddressInfo } from "node:net";
import { chromium, Browser } from "playwright";
import { SubmissionConfirmationDetector } from "./SubmissionConfirmationDetector";

describe("SubmissionConfirmationDetector", () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    server = http.createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });

      if (request.url === "/success") {
        response.end("<html><body><h1>Thank you for applying</h1><p>Your application has been received.</p></body></html>");
        return;
      }

      if (request.url === "/url-success") {
        response.end("<html><body><h1>Application form</h1></body></html>");
        return;
      }

      if (request.url === "/false-positive") {
        response.end("<html><body><h1>Frontend Engineer</h1><p>This role has received many applications and the application has been submitted by previous candidates.</p></body></html>");
        return;
      }

      response.end("<html><body><h1>Application form</h1><button>Submit Application</button></body></html>");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("confirms strong success text and preserves the current URL", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/success`);

    const result = await new SubmissionConfirmationDetector().detect(page);

    expect(result.confirmed).toBe(true);
    expect(result.confirmationUrl).toBe(`${baseUrl}/success`);
    expect(result.signal).toContain("Page text");

    await page.close();
  });

  it("confirms a known success URL path even without confirmation text", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/url-success?next=/thank-you`);

    const result = await new SubmissionConfirmationDetector().detect(page);

    expect(result.confirmed).toBe(true);
    expect(result.confirmationUrl).toBe(`${baseUrl}/url-success?next=/thank-you`);
    expect(result.signal).toContain("Confirmation URL path");

    await page.close();
  });

  it("does not treat ordinary job-description text as submission confirmation", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/false-positive`);

    const result = await new SubmissionConfirmationDetector().detect(page);

    expect(result.confirmed).toBe(false);
    expect(result.confirmationUrl).toBeNull();
    expect(result.signal).toBeNull();

    await page.close();
  });

  it("does not treat an ordinary application form as submitted", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/form`);

    const result = await new SubmissionConfirmationDetector().detect(page);

    expect(result.confirmed).toBe(false);
    expect(result.confirmationUrl).toBeNull();
    expect(result.signal).toBeNull();

    await page.close();
  });
});
