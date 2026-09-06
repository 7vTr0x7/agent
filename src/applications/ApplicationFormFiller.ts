import { existsSync, statSync } from "node:fs";
import { Page } from "playwright";
import { ApplicationFieldMapping } from "./ApplicationFieldMapper";

export interface ApplicationFieldFillResult {
  mapping: ApplicationFieldMapping;
  filled: boolean;
  reason: string;
}

export interface ApplicationFormFillResult {
  results: readonly ApplicationFieldFillResult[];
}

export class ApplicationFormFiller {
  async fill(
    page: Page,
    mappings: readonly ApplicationFieldMapping[]
  ): Promise<ApplicationFormFillResult> {
    const results: ApplicationFieldFillResult[] = [];

    for (const mapping of mappings) {
      if (!mapping.autoFill || mapping.key === null || mapping.value === null) {
        results.push({
          mapping,
          filled: false,
          reason: mapping.autoFill
            ? "No safe candidate value is available."
            : "Automatic filling is not approved for this field."
        });
        continue;
      }

      if (mapping.field.type === "file") {
        results.push(await this.fillFile(page, mapping));
        continue;
      }

      if (mapping.field.type === "select") {
        results.push(await this.fillSelect(page, mapping));
        continue;
      }

      if (!["text", "email", "tel", "url", "textarea"].includes(mapping.field.type)) {
        results.push({
          mapping,
          filled: false,
          reason: `Field type '${mapping.field.type}' is not supported for automatic filling.`
        });
        continue;
      }

      try {
        const locator = await this.resolveSingleLocator(page, mapping);
        if (!locator) {
          results.push({
            mapping,
            filled: false,
            reason: "Could not identify exactly one target field; manual review required."
          });
          continue;
        }

        await locator.fill(String(mapping.value));
        results.push({ mapping, filled: true, reason: "Field filled successfully." });
      } catch (error) {
        results.push({
          mapping,
          filled: false,
          reason: `Field could not be filled safely: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    return { results };
  }

  private async resolveSingleLocator(page: Page, mapping: ApplicationFieldMapping) {
    const locator = this.locatorFor(page, mapping);
    const count = await locator.count();
    if (count === 1) return locator;
    if (count === 0) return null;

    const visible = locator.locator(":visible");
    return (await visible.count()) === 1 ? visible : null;
  }

  private locatorFor(page: Page, mapping: ApplicationFieldMapping) {
    const { field } = mapping;
    if (field.name) return page.locator(`[name=${JSON.stringify(field.name)}]:not([disabled])`);
    if (field.label) return page.getByLabel(field.label, { exact: true }).locator(":not([disabled])");
    if (field.placeholder) return page.getByPlaceholder(field.placeholder, { exact: true }).locator(":not([disabled])");
    return page.locator("__missing_application_field__");
  }

  private async fillSelect(
    page: Page,
    mapping: ApplicationFieldMapping
  ): Promise<ApplicationFieldFillResult> {
    try {
      const locator = await this.resolveSingleLocator(page, mapping);
      if (!locator) {
        return {
          mapping,
          filled: false,
          reason: "Could not identify exactly one target select; manual review required."
        };
      }

      const expected = String(mapping.value).trim();
      const options = await locator.locator("option").evaluateAll((elements) =>
        elements.map((element) => ({
          value: element.getAttribute("value") ?? "",
          label: element.textContent?.trim() ?? ""
        }))
      );

      const normalizedExpected = normalizeOptionText(expected);
      const exact = options.find(
        (option) => normalizeOptionText(option.value) === normalizedExpected
      );
      const labelMatch = options.find(
        (option) => normalizeOptionText(option.label) === normalizedExpected
      );

      const match = exact ?? labelMatch;
      if (!match || !match.value) {
        return {
          mapping,
          filled: false,
          reason: "Candidate value does not exactly match a select option; manual review required."
        };
      }

      await locator.selectOption(match.value);
      return { mapping, filled: true, reason: "Select option matched exactly and selected." };
    } catch (error) {
      return {
        mapping,
        filled: false,
        reason: `Select could not be filled safely: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async fillFile(
    page: Page,
    mapping: ApplicationFieldMapping
  ): Promise<ApplicationFieldFillResult> {
    if (typeof mapping.value !== "string" || !mapping.value) {
      return { mapping, filled: false, reason: "Resume path is missing." };
    }

    if (!existsSync(mapping.value) || !statSync(mapping.value).isFile()) {
      return { mapping, filled: false, reason: "Resume path does not point to an existing file." };
    }

    try {
      const locator = await this.resolveSingleLocator(page, mapping);
      if (!locator) {
        return {
          mapping,
          filled: false,
          reason: "Could not identify exactly one file input; manual review required."
        };
      }

      await locator.setInputFiles(mapping.value);
      return { mapping, filled: true, reason: "Resume uploaded successfully." };
    } catch (error) {
      return {
        mapping,
        filled: false,
        reason: `Resume could not be uploaded safely: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

function normalizeOptionText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
