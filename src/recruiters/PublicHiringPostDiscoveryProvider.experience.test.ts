import { experienceCompatible } from "./PublicHiringPostDiscoveryProvider";

describe("experienceCompatible for a three-year candidate", () => {
  test.each([
    "1-2 years",
    "2-3 years",
    "1+ years",
    "2+ years",
    "0-2 years",
    "1–2 years",
    "2–3 years",
    "3+ years",
    "2 to 4 years",
  ])("accepts compatible requirement: %s", requirement => {
    expect(experienceCompatible(requirement, 3)).toBe(true);
  });

  test.each([
    "4-7 years",
    "4–6 years",
    "5+ years",
    "6+ years",
  ])("rejects requirements starting above three years: %s", requirement => {
    expect(experienceCompatible(requirement, 3)).toBe(false);
  });

  test("rejects a mixed-seniority post when neither listed band fits", () => {
    expect(experienceCompatible("Junior: 1-2 years; Senior: 5+ years", 3)).toBe(false);
  });

  test("accepts posts without an explicit experience requirement", () => {
    expect(experienceCompatible("React, Next.js and TypeScript required", 3)).toBe(true);
  });
});
