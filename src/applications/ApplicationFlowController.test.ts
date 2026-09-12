import { chromium } from "playwright";
import { ApplicationFlowController } from "./ApplicationFlowController";
import { CandidateProfile } from "../candidates/CandidateProfile";

describe("ApplicationFlowController", () => {
  it("fills safe fields and advances through multiple application pages", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const profile: CandidateProfile = { id: "candidate-1", yearsExperience: 3, skills: ["React.js"], targetTitles: ["Frontend Engineer"], firstName: "Salman", lastName: "Shaikh", email: "salman@example.com", phone: "+919999999999", resumePath: undefined };
    await page.route("http://application.test/**", async (route) => { await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" }); });
    await page.goto("http://application.test/");
    await page.setContent(`
      <form id="application">
        <label for="first">First name</label>
        <input id="first" name="firstName" required />
        <button type="button" id="next">Continue</button>
      </form>
      <script>
        document.getElementById('next').addEventListener('click', () => {
          document.getElementById('application').innerHTML = ` + "`" + `
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required />
            <button type="submit">Submit application</button>
          ` + "`" + `;
        });
      </script>
    `);
    const result = await new ApplicationFlowController().prepare(page, profile, "Example Company", []);
    expect(result.allowed).toBe(true);
    expect(result.pagesProcessed).toBe(2);
    expect(await page.locator("#email").inputValue()).toBe("salman@example.com");
    expect(result.mappings).toHaveLength(2);
    expect(result.fillResults.filter((entry) => entry.filled)).toHaveLength(2);
    await context.close();
    await browser.close();
  });

  it("fails closed when a required field has no approved candidate value", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const profile: CandidateProfile = { id: "candidate-1", yearsExperience: 3, skills: ["React.js"], targetTitles: ["Frontend Engineer"] };
    await page.route("http://application.test/**", async (route) => { await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" }); });
    await page.goto("http://application.test/");
    await page.setContent(`<form><label for="email">Email</label><input id="email" name="email" type="email" required /><button type="submit">Submit application</button></form>`);
    const result = await new ApplicationFlowController().prepare(page, profile, "Example Company", []);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Email");
    expect(result.pagesProcessed).toBe(1);
    await context.close();
    await browser.close();
  });

  it("fails closed when a final submit control is absent", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const profile: CandidateProfile = { id: "candidate-1", yearsExperience: 3, skills: ["React.js"], targetTitles: ["Frontend Engineer"], email: "salman@example.com" };
    await page.setContent(`<form><label for="email">Email</label><input id="email" name="email" type="email" required /></form>`);
    const result = await new ApplicationFlowController().prepare(page, profile, "Example Company", []);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("final application submit");
    await context.close();
    await browser.close();
  });
});
