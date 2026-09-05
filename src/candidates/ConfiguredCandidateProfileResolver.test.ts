import { ConfiguredCandidateProfileResolver } from "./ConfiguredCandidateProfileResolver";

describe("ConfiguredCandidateProfileResolver", () => {
  it("loads a profile from environment values", async () => {
    const resolver = ConfiguredCandidateProfileResolver.fromEnvironment({
      CANDIDATE_PROFILE_ID: "candidate-1",
      CANDIDATE_YEARS_EXPERIENCE: "3",
      CANDIDATE_SKILLS: "React.js, TypeScript, Next.js",
      CANDIDATE_TARGET_TITLES: "Frontend Engineer, Full Stack Engineer",
      CANDIDATE_EMAIL: "candidate@example.com",
      CANDIDATE_LOCATION: "Bengaluru"
    });

    await expect(resolver.getById("candidate-1")).resolves.toMatchObject({
      id: "candidate-1",
      yearsExperience: 3,
      skills: ["React.js", "TypeScript", "Next.js"],
      targetTitles: ["Frontend Engineer", "Full Stack Engineer"],
      email: "candidate@example.com",
      location: "Bengaluru"
    });
  });

  it("returns null for an unknown candidate profile", async () => {
    const resolver = new ConfiguredCandidateProfileResolver({
      id: "candidate-1",
      yearsExperience: 3,
      skills: ["React.js"],
      targetTitles: ["Frontend Engineer"]
    });

    await expect(resolver.getById("candidate-2")).resolves.toBeNull();
  });

  it("rejects malformed numeric and boolean values", () => {
    expect(() =>
      ConfiguredCandidateProfileResolver.fromEnvironment({
        CANDIDATE_PROFILE_ID: "candidate-1",
        CANDIDATE_YEARS_EXPERIENCE: "three",
        CANDIDATE_SKILLS: "React.js",
        CANDIDATE_TARGET_TITLES: "Frontend Engineer"
      })
    ).toThrow("CANDIDATE_YEARS_EXPERIENCE must be a non-negative number");

    expect(() =>
      ConfiguredCandidateProfileResolver.fromEnvironment({
        CANDIDATE_PROFILE_ID: "candidate-1",
        CANDIDATE_YEARS_EXPERIENCE: "3",
        CANDIDATE_SKILLS: "React.js",
        CANDIDATE_TARGET_TITLES: "Frontend Engineer",
        CANDIDATE_SPONSORSHIP_REQUIRED: "yes"
      })
    ).toThrow("CANDIDATE_SPONSORSHIP_REQUIRED must be true or false");
  });
});
