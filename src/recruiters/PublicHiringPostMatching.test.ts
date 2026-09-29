import { experienceCompatible, recruiterEmailLocalPartMatchesName, substantiveRoleEvidence } from "./PublicHiringPostDiscoveryProvider";

describe("public hiring evidence matching", () => {
  test.each([
    ["john.doe", true],
    ["johndoe", true],
    ["jdoe", true],
    ["john_d", true],
    ["j.doe", true],
    ["john.d", true],
    ["doej", true],
    ["john-doe", true],
    ["john_doe", true],
    ["john.doe123", true],
    ["aksharma", false],
    ["asharma", false],
    ["amitk", false],
    ["unrelated.person", false],
  ])("matches common recruiter email alias %s", (localPart, expected) => {
    expect(recruiterEmailLocalPartMatchesName("John Doe", localPart)).toBe(expected);
  });

  test("matches multi-part recruiter names", () => {
    expect(recruiterEmailLocalPartMatchesName("Amit Kumar Sharma", "aksharma")).toBe(true);
    expect(recruiterEmailLocalPartMatchesName("Amit Kumar Sharma", "amitkumarsharma")).toBe(true);
    expect(recruiterEmailLocalPartMatchesName("Amit Kumar Sharma", "amitk")).toBe(true);
    expect(recruiterEmailLocalPartMatchesName("Amit Kumar Sharma", "sharmaa")).toBe(true);
  });

  test.each([
    ["We are hiring for a product team. Responsibilities: build React and TypeScript interfaces, reusable components, REST API integrations, responsive dashboards and frontend tests. Experience: 2-4 years.", true],
    ["Responsibilities include React 18, TypeScript, hooks, state management, REST APIs, Core Web Vitals and Playwright. Experience: 2-4 years.", true],
    ["Responsibilities: build React interfaces and Node.js APIs with Express and MongoDB. Experience: 2+ years.", true],
    ["Responsibilities: JavaScript, Python, SQL, GIS, Mapbox, PostGIS and QGIS. Experience: 3-5 years.", false],
    ["Responsibilities: Angular, SCSS, LESS, jQuery, RequireJS and browser compatibility. Experience: 4-6 years.", false],
  ])("uses substantive job evidence instead of requiring a role title", (text, expected) => {
    expect(Boolean(substantiveRoleEvidence(text).role)).toBe(expected);
  });

  test.each([
    ["Experience: 3+ years", true],
    ["Experience: 2-4 years", true],
    ["Experience: 0-5 years", true],
    ["Experience: 4-7 years", false],
    ["Experience: 4-6 years", false],
    ["Junior: 1-2 years. Senior: 5+ years.", false],
    ["Experience: 1-3 years", true],
  ])("checks whether candidate experience fits %s", (text, expected) => {
    expect(experienceCompatible(text, 3)).toBe(expected);
  });
});
