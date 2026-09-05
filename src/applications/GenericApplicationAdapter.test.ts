import http from "node:http";
import { AddressInfo } from "node:net";
import { chromium, Browser } from "playwright";
import { GenericApplicationAdapter } from "./GenericApplicationAdapter";
import { ApplicationContext } from "./ApplicationAdapter";

describe("GenericApplicationAdapter", () => {
  let browser: Browser;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    server = http.createServer((request, response) => {
      if (request.url === "/apply") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <html>
            <body>
              <form>
                <label for="email">Email</label>
                <input id="email" name="email" type="email" required />
                <button type="submit">Apply Now</button>
              </form>
            </body>
          </html>
        `);
        return;
      }

      if (request.url === "/success") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html><body><h1>Thank you for applying</h1></body></html>");
        return;
      }

      response.writeHead(404);
      response.end();
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

  it("clicks a unique verified submit control and requires confirmation", async () => {
    const page = await browser.newPage();
    const context: ApplicationContext = {
      jobOpportunityId: "job-1",
      candidateProfileId: "candidate-1",
      applicationId: "application-1",
      url: `${baseUrl}/apply`
    };

    try {
      await page.goto(context.url);
      await page.locator("[name=email]").fill("candidate@example.com");

      const adapter = new GenericApplicationAdapter();
      const result = await adapter.submit(page, context);

      expect(result.submitted).toBe(true);
      expect(result.confirmationUrl).toBe(`${baseUrl}/success`);
      expect(result.reason).toContain("Page text");
    } finally {
      await page.close();
    }
  });

  it("does not report success when the submit control is ambiguous", async () => {
    const page = await browser.newPage();
    const context: ApplicationContext = {
      jobOpportunityId: "job-2",
      candidateProfileId: "candidate-1",
      applicationId: "application-2",
      url: `${baseUrl}/apply`
    };

    try {
      await page.goto(context.url);
      await page.locator("form").evaluate((form) => {
        form.insertAdjacentHTML("beforeend", '<button type="button">Submit</button>');
      });

      const result = await new GenericApplicationAdapter().submit(page, context);

      expect(result.submitted).toBe(false);
      expect(result.confirmationUrl).toBeNull();
      expect(result.reason).toContain("Multiple possible submit buttons");
    } finally {
      await page.close();
    }
  });
});
