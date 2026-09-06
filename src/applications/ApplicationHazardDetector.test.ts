import { BrowserSessionService } from "./BrowserSession";
import { ApplicationHazardDetector } from "./ApplicationHazardDetector";

describe("ApplicationHazardDetector", () => {
  it("blocks CAPTCHA and human-verification challenges", async () => {
    const browser = new BrowserSessionService({ headless: true });
    const session = await browser.create();

    try {
      await session.page.setContent("<main>Please verify you are human</main>");
      const hazards = await new ApplicationHazardDetector().detect(session.page);

      expect(hazards.map((hazard) => hazard.kind)).toContain("captcha");
    } finally {
      await browser.close(session);
    }
  });

  it("blocks assessments and work-authorization questions", async () => {
    const browser = new BrowserSessionService({ headless: true });
    const session = await browser.create();

    try {
      await session.page.setContent(`
        <main>
          <p>Technical assessment required.</p>
          <p>Are you legally authorized to work in this country?</p>
        </main>
      `);
      const hazards = await new ApplicationHazardDetector().detect(session.page);

      expect(hazards.map((hazard) => hazard.kind)).toEqual(
        expect.arrayContaining(["assessment", "work-authorization"])
      );
    } finally {
      await browser.close(session);
    }
  });

  it("blocks sensitive identity or financial information", async () => {
    const browser = new BrowserSessionService({ headless: true });
    const session = await browser.create();

    try {
      await session.page.setContent("<label>Aadhaar number</label><input />");
      const hazards = await new ApplicationHazardDetector().detect(session.page);

      expect(hazards.map((hazard) => hazard.kind)).toContain("sensitive-data");
    } finally {
      await browser.close(session);
    }
  });

  it("detects CAPTCHA providers referenced by iframe URLs", async () => {
    const browser = new BrowserSessionService({ headless: true });
    const session = await browser.create();

    try {
      await session.page.setContent(
        '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>'
      );
      const hazards = await new ApplicationHazardDetector().detect(session.page);

      expect(hazards.map((hazard) => hazard.kind)).toContain("captcha");
    } finally {
      await browser.close(session);
    }
  });
});
