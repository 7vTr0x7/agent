import { evaluateApplicationPolicy } from "./ApplicationPolicy";

describe("evaluateApplicationPolicy", () => {
  const base = {
    matchDecision: "APPLY" as const,
    opportunityStatus: "ACTIVE" as const,
    hasRanking: true,
    hasExistingApplication: false,
    companyName: "Acme",
    excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"]
  };

  it("allows a fully eligible application", () => {
    expect(evaluateApplicationPolicy(base)).toEqual({
      decision: "ALLOW",
      reason: "Application passed all safety gates."
    });
  });

  it("blocks non-APPLY decisions", () => {
    expect(
      evaluateApplicationPolicy({ ...base, matchDecision: "REVIEW" })
    ).toEqual({
      decision: "BLOCK",
      reason: "Job match decision is not APPLY."
    });
  });

  it("blocks inactive opportunities", () => {
    expect(
      evaluateApplicationPolicy({ ...base, opportunityStatus: "STALE" })
    ).toEqual({
      decision: "BLOCK",
      reason: "Job opportunity is not active."
    });
  });

  it("blocks missing rankings", () => {
    expect(
      evaluateApplicationPolicy({ ...base, hasRanking: false })
    ).toEqual({
      decision: "BLOCK",
      reason: "Job has no persisted ranking."
    });
  });

  it("blocks duplicate applications", () => {
    expect(
      evaluateApplicationPolicy({ ...base, hasExistingApplication: true })
    ).toEqual({
      decision: "BLOCK",
      reason: "An application already exists for this opportunity."
    });
  });

  it("blocks excluded companies case-insensitively", () => {
    expect(
      evaluateApplicationPolicy({
        ...base,
        companyName: "  sketch brahma technologies "
      })
    ).toEqual({
      decision: "BLOCK",
      reason: "Company is excluded by application policy."
    });
  });

  it("blocks permanent exclusions even when configuration omits them", () => {
    expect(
      evaluateApplicationPolicy({
        ...base,
        excludedCompanies: [],
        companyName: "  Octopus Technologies "
      })
    ).toEqual({
      decision: "BLOCK",
      reason: "Company is excluded by application policy."
    });

    expect(
      evaluateApplicationPolicy({
        ...base,
        excludedCompanies: [],
        companyName: "  SKETCH BRAHMA TECHNOLOGIES "
      })
    ).toEqual({
      decision: "BLOCK",
      reason: "Company is excluded by application policy."
    });
  });
});
