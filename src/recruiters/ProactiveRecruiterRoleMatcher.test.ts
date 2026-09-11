import { ProactiveRecruiterRoleMatcher } from "./ProactiveRecruiterRoleMatcher";

describe("ProactiveRecruiterRoleMatcher", () => {
  const matcher = new ProactiveRecruiterRoleMatcher();

  it("derives target role terms from the candidate profile", () => {
    expect(matcher.buildTargetTerms({ targetRoles: ["Frontend Engineer"], skills: ["React", "TypeScript"] })).toEqual(
      expect.arrayContaining(["frontend engineer", "react", "typescript"]),
    );
  });

  it("requires role-relevant evidence instead of accepting a generic recruiter", () => {
    expect(matcher.match({ skills: ["React", "TypeScript"] }, "Recruiter", "General hiring support").score).toBe(0);
    expect(matcher.match({ skills: ["React", "TypeScript"] }, "Technical Recruiter", "Recruiting React and frontend engineers").score).toBeGreaterThan(0);
  });
});
