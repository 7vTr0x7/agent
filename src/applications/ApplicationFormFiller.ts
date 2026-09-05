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

      if (!["text", "email", "tel", "url", "textarea"].includes(mapping.field.type)) {
        results.push({
          mapping,
          filled: false,
          reason: `Field type '${mapping.field.type}' is not supported for automatic filling.`
        });
        continue;
      }

      try {
        const locator = this.locatorFor(page, mapping);
        if (await locator.count() !== 1) {
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

  private locatorFor(page: Page, mapping: ApplicationFieldMapping) {
    const { field } = mapping;
    if (field.name) return page.locator(`[name=${JSON.stringify(field.name)}]`);
    if (field.label) return page.getByLabel(field.label, { exact: true });
    if (field.placeholder) return page.getByPlaceholder(field.placeholder, { exact: true });
    return page.locator("__missing_application_field__");
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
      const locator = this.locatorFor(page, mapping);
      if (await locator.count() !== 1) {
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
