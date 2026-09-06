import { ApplicationField } from "./FormFieldDetector";
import { ApplicationFieldMapping } from "./ApplicationFieldMapper";
import { ApplicationFieldFillResult } from "./ApplicationFormFiller";
import { SubmissionSafetyGate } from "./SubmissionSafetyGate";

function mapping(
  overrides: Partial<ApplicationFieldMapping> = {}
): ApplicationFieldMapping {
  const field: ApplicationField = {
    name: "email",
    type: "email",
    required: true,
    label: "Email Address",
    placeholder: null
  };

  return {
    field,
    key: "email",
    value: "salman@example.com",
    confidence: 1,
    autoFill: true,
    reason: "Deterministic field mapping with high confidence.",
    ...overrides
  };
}

function filledResult(
  applicationMapping: ApplicationFieldMapping,
  filled = true
): ApplicationFieldFillResult {
  return {
    mapping: applicationMapping,
    filled,
    reason: filled ? "Field filled successfully." : "Field could not be filled safely."
  };
}

describe("SubmissionSafetyGate", () => {
  const gate = new SubmissionSafetyGate();

  it("allows submission only when every required field was safely filled", () => {
    const email = mapping();
    const result = gate.evaluate({
      url: "https://example.com/apply",
      companyName: "Example Corp",
      excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
      mappings: [email],
      fillResults: [filledResult(email)]
    });

    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("blocks required fields that are unsafe or unresolved", () => {
    const experience = mapping({
      field: {
        name: "experience",
        type: "text",
        required: true,
        label: "Years of experience",
        placeholder: null
      },
      key: "yearsExperience",
      value: 3,
      autoFill: false,
      reason: "Field requires policy-aware review before automatic filling."
    });

    const result = gate.evaluate({
      url: "https://example.com/apply",
      companyName: "Example Corp",
      excludedCompanies: [],
      mappings: [experience],
      fillResults: [filledResult(experience, false)]
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(
      "Required field 'Years of experience' is not approved for automatic submission."
    );
  });

  it("blocks a required field when filling failed", () => {
    const email = mapping();
    const result = gate.evaluate({
      url: "https://example.com/apply",
      companyName: "Example Corp",
      excludedCompanies: [],
      mappings: [email],
      fillResults: [filledResult(email, false)]
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(
      "Required field 'Email Address' was not filled successfully."
    );
  });

  it("blocks excluded companies even when the form is otherwise safe", () => {
    const email = mapping();
    const result = gate.evaluate({
      url: "https://example.com/apply",
      companyName: " sketch brahma technologies ",
      excludedCompanies: ["Sketch Brahma Technologies"],
      mappings: [email],
      fillResults: [filledResult(email)]
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("Company is excluded by application policy.");
  });

  it("blocks permanent exclusions even when runtime exclusions are empty", () => {
    const email = mapping();
    for (const companyName of ["Octopus Technologies", "Sketch Brahma Technologies"]) {
      const result = gate.evaluate({
        url: "https://example.com/apply",
        companyName: ` ${companyName.toUpperCase()} `,
        excludedCompanies: [],
        mappings: [email],
        fillResults: [filledResult(email)]
      });

      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("Company is excluded by application policy.");
    }
  });

  it("blocks non-http application URLs", () => {
    const email = mapping();
    const result = gate.evaluate({
      url: "javascript:alert(1)",
      companyName: "Example Corp",
      excludedCompanies: [],
      mappings: [email],
      fillResults: [filledResult(email)]
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("Application URL must use HTTP or HTTPS.");
  });
});
