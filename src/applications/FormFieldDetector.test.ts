import { chromium } from "playwright";
import { FormFieldDetector } from "./FormFieldDetector";

describe("FormFieldDetector", () => {
  it("detects common application field types and required fields", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.setContent(`
      <form>
        <label for="name">Full name</label>
        <input id="name" name="name" type="text" required />
        <label>Email <input name="email" type="email" /></label>
        <label for="resume">Resume</label>
        <input id="resume" name="resume" type="file" required />
        <textarea name="summary" placeholder="About you"></textarea>
      </form>
    `);

    const fields = await new FormFieldDetector().detect(page);

    expect(fields).toEqual([
      {
        name: "name",
        type: "text",
        required: true,
        label: "Full name",
        placeholder: null
      },
      {
        name: "email",
        type: "email",
        required: false,
        label: "Email",
        placeholder: null
      },
      {
        name: "resume",
        type: "file",
        required: true,
        label: "Resume",
        placeholder: null
      },
      {
        name: "summary",
        type: "textarea",
        required: false,
        label: null,
        placeholder: "About you"
      }
    ]);

    await context.close();
    await browser.close();
  });
});
