import { createServer, Server } from "node:http";
import { BrowserSessionService } from "./BrowserSession";
import { ApplicationTargetResolver } from "./ApplicationTargetResolver";

describe("ApplicationTargetResolver", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });

      if (request.url === "/job") {
        response.end(`
          <main>
            <h1>Frontend Engineer</h1>
            <a href="/apply">Apply Now</a>
          </main>
        `);
        return;
      }

      if (request.url === "/apply") {
        response.end(`
          <form>
            <label for="name">Full Name</label>
            <input id="name" name="name" required />
          </form>
        `);
        return;
      }

      response.end("<main>No application target</main>");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("follows a single verified application link without clicking a submit control", async () => {
    const browser = new BrowserSessionService({ headless: true });
    const session = await browser.create();

    try {
      await session.page.goto(`${baseUrl}/job`, { waitUntil: "domcontentloaded" });
      const result = await new ApplicationTargetResolver().resolve(session.page, `${baseUrl}/job`);

      expect(result.resolved).toBe(true);
      expect(result.startedFromJobPage).toBe(true);
      expect(result.url).toBe(`${baseUrl}/apply`);
      expect(await session.page.locator("form").count()).toBe(1);
    } finally {
      await browser.close(session);
    }
  });

  it("refuses ambiguous application entry points", async () => {
    const browser = new BrowserSessionService({ headless: true });
    const session = await browser.create();

    try {
      await session.page.setContent(`
        <a href="/one">Apply</a>
        <a href="/two">Apply Now</a>
      `);

      const result = await new ApplicationTargetResolver().resolve(session.page, `${baseUrl}/job`);

      expect(result.resolved).toBe(false);
      expect(result.reason).toContain("Multiple application entry points");
    } finally {
      await browser.close(session);
    }
  });

  it("blocks login and account-creation pages", async () => {
    const browser = new BrowserSessionService({ headless: true });
    const session = await browser.create();

    try {
      await session.page.setContent(`
        <form>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required />
          <button type="submit">Sign in</button>
        </form>
      `);

      const result = await new ApplicationTargetResolver().resolve(session.page, `${baseUrl}/login`);

      expect(result.resolved).toBe(false);
      expect(result.reason).toContain("authentication");
    } finally {
      await browser.close(session);
    }
  });
});
