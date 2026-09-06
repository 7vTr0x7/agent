import { ApplicationFieldFillResult } from "./ApplicationFormFiller";
import { ApplicationFieldMapping } from "./ApplicationFieldMapper";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "./ApplicationPolicy";

export interface SubmissionSafetyInput {
  url: string;
  companyName: string;
  excludedCompanies: readonly string[];
  mappings: readonly ApplicationFieldMapping[];
  fillResults: readonly ApplicationFieldFillResult[];
}

export interface SubmissionSafetyResult {
  allowed: boolean;
  reasons: readonly string[];
}

export class SubmissionSafetyGate {
  evaluate(input: SubmissionSafetyInput): SubmissionSafetyResult {
    const reasons: string[] = [];

    if (!/^https?:\/\//i.test(input.url)) {
      reasons.push("Application URL must use HTTP or HTTPS.");
    }

    const company = input.companyName.trim().toLowerCase();
    const excludedCompanies = [
      ...PERMANENTLY_EXCLUDED_COMPANIES,
      ...input.excludedCompanies
    ];
    if (
      excludedCompanies.some(
        (name) => name.trim().toLowerCase() === company
      )
    ) {
      reasons.push("Company is excluded by application policy.");
    }

    const fillByField = new Map<ApplicationFieldMapping, ApplicationFieldFillResult>(
      input.fillResults.map((result) => [result.mapping, result])
    );

    for (const mapping of input.mappings) {
      if (!mapping.field.required) continue;

      if (!mapping.autoFill || mapping.key === null || mapping.value === null) {
        reasons.push(
          `Required field '${fieldName(mapping)}' is not approved for automatic submission.`
        );
        continue;
      }

      const fillResult = fillByField.get(mapping);
      if (!fillResult?.filled) {
        reasons.push(
          `Required field '${fieldName(mapping)}' was not filled successfully.`
        );
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons
    };
  }
}

function fieldName(mapping: ApplicationFieldMapping): string {
  return mapping.field.label ?? mapping.field.name ?? mapping.field.type;
}
