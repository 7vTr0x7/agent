import { Page, Locator } from "playwright";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { ApplicationFieldMapper, ApplicationFieldMapping } from "./ApplicationFieldMapper";
import { ApplicationFormFiller, ApplicationFieldFillResult } from "./ApplicationFormFiller";
import { FormFieldDetector } from "./FormFieldDetector";
import { SubmissionSafetyGate } from "./SubmissionSafetyGate";
import { ApplicationHazardDetector } from "./ApplicationHazardDetector";

export interface ApplicationFlowResult {
  allowed: boolean;
  reasons: readonly string[];
  pagesProcessed: number;
  mappings: readonly ApplicationFieldMapping[];
  fillResults: readonly ApplicationFieldFillResult[];
}

const NEXT_LABEL = /^(?:next|continue|continue application|continue to review|save and continue|next step|review application|proceed)$/i;
const MAX_STEPS = 8;

export class ApplicationFlowController {
  constructor(
    private readonly detector = new FormFieldDetector(),
    private readonly mapper = new ApplicationFieldMapper(),
    private readonly filler = new ApplicationFormFiller(),
    private readonly safetyGate = new SubmissionSafetyGate(),
    private readonly hazardDetector = new ApplicationHazardDetector()
  ) {}

  async prepare(
    page: Page,
    candidateProfile: CandidateProfile,
    companyName: string,
    excludedCompanies: readonly string[]
  ): Promise<ApplicationFlowResult> {
    const mappings: ApplicationFieldMapping[] = [];
    const fillResults: ApplicationFieldFillResult[] = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);

      const hazards = await this.hazardDetector.detect(page);
      if (hazards.length > 0) {
        return {
          allowed: false,
          reasons: hazards.map((hazard) => hazard.reason),
          pagesProcessed: step + 1,
          mappings,
          fillResults
        };
      }

      const fields = await this.detector.detect(page);
      const pageMappings = this.mapper.map(fields, candidateProfile);
      const pageFillResults = (await this.filler.fill(page, pageMappings)).results;
      mappings.push(...pageMappings);
      fillResults.push(...pageFillResults);

      const safety = this.safetyGate.evaluate({
        url: page.url(),
        companyName,
        excludedCompanies,
        mappings: pageMappings,
        fillResults: pageFillResults
      });

      if (!safety.allowed) {
        return {
          allowed: false,
          reasons: safety.reasons,
          pagesProcessed: step + 1,
          mappings,
          fillResults
        };
      }

      const next = await this.resolveNextControl(page);
      if (!next) {
        return {
          allowed: true,
          reasons: [],
          pagesProcessed: step + 1,
          mappings,
          fillResults
        };
      }

      try {
        await next.click();
      } catch (error) {
        return {
          allowed: false,
          reasons: [`Application flow could not advance safely: ${error instanceof Error ? error.message : String(error)}`],
          pagesProcessed: step + 1,
          mappings,
          fillResults
        };
      }

      await Promise.race([
        page.waitForLoadState("domcontentloaded").catch(() => undefined),
        page.waitForTimeout(1500)
      ]);
      await page.waitForTimeout(250);
    }

    return {
      allowed: false,
      reasons: [`Application flow exceeded the safe ${MAX_STEPS}-step limit; manual review required.`],
      pagesProcessed: MAX_STEPS,
      mappings,
      fillResults
    };
  }

  private async resolveNextControl(page: Page): Promise<Locator | null> {
    const controls = page.locator("button, input[type='button'], input[type='submit'], a");
    const matches: Locator[] = [];

    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible().catch(() => false)) || !(await control.isEnabled().catch(() => false))) continue;

      const label = await this.readLabel(control);
      if (!NEXT_LABEL.test(label)) continue;
      matches.push(control);
    }

    return matches.length === 1 ? matches[0] ?? null : null;
  }

  private async readLabel(control: Locator): Promise<string> {
    const text = (await control.innerText().catch(() => "")).trim();
    if (text) return text;
    const value = ((await control.getAttribute("value")) ?? "").trim();
    if (value) return value;
    const ariaLabel = ((await control.getAttribute("aria-label")) ?? "").trim();
    if (ariaLabel) return ariaLabel;
    return ((await control.getAttribute("title")) ?? "").trim();
  }
}
