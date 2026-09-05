import http from "node:http";
import { BrowserSessionService } from "./BrowserSession";
import { VerifiedSubmissionExecutor } from "./VerifiedSubmissionExecutor";

describe("VerifiedSubmissionExecutor", () => {
  let server: http.Server;
  let url = "";
  let submitted = false;
  const browser = new BrowserSessionService({ headless: true });

  beforeAll(async () => {
    server = http.createServer((_, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <!doctype html>
        <html>
          <body>
            <form id="application">
              <button id="submit" type="button">Submit Application</button>
            </form>
            <script>
              document.getElementById("submit").addEventListener("click", () => {
                fetch("/submitted", { method: "POST" });
              });
            </script>
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine test server address.");
    }
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  test("clicks exactly one verified visible and enabled submit button", async () => {
    const session = await browser.create();
    const requests: string[] = [];
    session.page.on("request", (request) => {
      if (request.url().endsWith("/submitted")) requests.push(request.url());
    });

    try {
      await session.page.goto(url, { waitUntil: "domcontentloaded" });

      const result = await new VerifiedSubmissionExecutor().execute(session.page);

      expect(result).toEqual({
        clicked: true,
        reason: "Verified submit button was clicked successfully."
      });

      await session.page.waitForTimeout(50);
      expect(requests).toHaveLength(1);
      submitted = true;
    } finally {
      await browser.close(session);
    }

    expect(submitted).toBe(true);
  });

  test("refuses to click when multiple submit buttons exist", async () => {
    const session = await browser.create();

    try {
      await session.page.setContent(`
        <button>Submit Application</button>
        <button>Submit Application</button>
      `);

      const result = await new VerifiedSubmissionExecutor().execute(session.page);

      expect(result).toEqual({
        clicked: false,
        reason: "Multiple possible submit buttons were found; manual review required."
      });
    } finally {
      await browser.close(session);
    }
  });
});
