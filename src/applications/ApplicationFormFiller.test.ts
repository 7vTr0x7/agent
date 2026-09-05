import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { ApplicationFieldMapper } from "./ApplicationFieldMapper";
import { ApplicationFormFiller } from "./ApplicationFormFiller";
import { FormFieldDetector } from "./FormFieldDetector";
import { CandidateProfile } from "../candidates/CandidateProfile";

describe("ApplicationFormFiller", () => {
  it("fills approved fields, uploads the resume, and leaves unsafe fields untouched", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const directory = mkdtempSync(join(tmpdir(), "job-agent-resume-"));
    const resumePath = join(directory, "resume.pdf");
    writeFileSync(resumePath, "synthetic resume");

    try {
      await page.setContent(`
        <form>
          <label for="first-name">First Name</label>
          <input id="first-name" name="first_name" type="text" required />
          <label for="email">Email Address</label>
          <input id="email" name="email" type="email" required />
          <label for="linkedin">LinkedIn Profile</label>
          <input id="linkedin" name="linkedin" type="url" />
          <label for="resume">Resume</label>
          <input id="resume" name="resume" type="file" required />
          <label for="experience">Years of experience</label>
          <input id="experience" name="experience" type="text" required />
        </form>
      `);

      const profile: CandidateProfile = {
        id: "candidate-1",
        yearsExperience: 3,
        skills: ["React", "TypeScript"],
        targetTitles: ["Frontend Engineer"],
        firstName: "Salman",
        email: "salman@example.com",
        linkedinUrl: "https://linkedin.com/in/example",
        resumePath
      };

      const fields = await new FormFieldDetector().detect(page);
      const mappings = new ApplicationFieldMapper().map(fields, profile);
      const result = await new ApplicationFormFiller().fill(page, mappings);

      await expectInputValue(page, '[name="first_name"]', "Salman");
      await expectInputValue(page, '[name="email"]', "salman@example.com");
      await expectInputValue(page, '[name="linkedin"]', "https://linkedin.com/in/example");
      await expectInputValue(page, '[name="experience"]', "");

      const files = await page.locator('[name="resume"]').evaluate((element) =>
        (element as HTMLInputElement).files?.length ?? 0
      );
      expect(files).toBe(1);

      const filled = result.results.filter((entry) => entry.filled);
      expect(filled).toHaveLength(4);
      expect(result.results.find((entry) => entry.mapping.key === "yearsExperience")?.filled).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      await context.close();
      await browser.close();
    }
  });
});

async function expectInputValue(page: import("playwright").Page, selector: string, expected: string): Promise<void> {
  await expect(page.locator(selector).inputValue()).resolves.toBe(expected);
}
