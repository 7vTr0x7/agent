import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";

const profile: CandidateProfile = {
  id: "candidate-1",
  yearsExperience: 3,
  skills: ["React", "Next.js", "TypeScript", "Redux Toolkit", "Node.js"],
  targetTitles: ["Frontend Engineer", "Frontend Developer"]
};

function job(description: string, title = "Frontend Developer"): JobOpportunity {
  return {
    id: "job-1",
    canonicalId: "canonical-1",
    canonicalUrl: "https://example.com/job-1",
    title,
    companyName: "Example",
    location: "Bengaluru",
    country: "India",
    workplaceType: "hybrid",
    employmentType: "full-time",
    description,
    postedAt: null,
    sourceUpdatedAt: null,
    lastSeenAt: new Date(),
    closedAt: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

describe("DeterministicJobMatcher", () => {
  const matcher = new DeterministicJobMatcher();

  it("scores matching skills and target titles", () => {
    const result = matcher.evaluate(job("React, TypeScript and Next.js are required. Node.js is a plus."), profile);
    expect(result.decision).toBe("APPLY");
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(result.matchedSkills).toEqual(expect.arrayContaining(["React", "Next.js", "TypeScript", "Node.js"]));
  });

  it("recognizes common technology aliases", () => {
    const result = matcher.evaluate(job("ReactJS, NextJS, TS, Redux Toolkit and NodeJS experience."), profile);
    expect(result.matchedSkills).toEqual(expect.arrayContaining(["React", "Next.js", "TypeScript", "Redux Toolkit", "Node.js"]));
    expect(result.decision).toBe("APPLY");
  });

  it("rejects a role with an explicit minimum experience blocker", () => {
    const result = matcher.evaluate(job("Must have at least 5 years of experience with React."), profile);
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ type: "HARD_BLOCKER" })]));
  });

  it("recognizes compact required experience syntax", () => {
    const result = matcher.evaluate(job("React and TypeScript. Experience: 5+ years."), profile);
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });

  it.each([
    ["3+ years", "React frontend engineer. Minimum 3 years of experience.", "APPLY"],
    ["1-3 years", "React frontend engineer. 1-3 years of relevant experience.", "APPLY"],
    ["2-4 years", "React frontend engineer. 2-4 years of relevant experience.", "APPLY"],
  ])("keeps compatible explicit experience requirement: %s", (_label, description, decision) => {
    const result = matcher.evaluate(job(description, "Frontend Engineer"), profile);
    expect(result.decision).toBe(decision);
  });

  it.each([
    ["5+ years", "React frontend engineer. 5+ years of Full Stack development experience.", "REJECT"],
    ["7+ years", "React frontend engineer. 7+ years of experience required.", "REJECT"],
    ["10+ years", "React frontend engineer. At least 10 years of experience.", "REJECT"],
    ["7 years minimum", "React frontend engineer. Experience: 7 years minimum.", "REJECT"],
    ["5 years in role", "React frontend engineer. At least 5 years in Software Developer role.", "REJECT"],
  ])("rejects explicit incompatible experience requirement: %s", (_label, description, decision) => {
    const result = matcher.evaluate(job(description, "Frontend Engineer"), profile);
    expect(result.decision).toBe(decision);
    expect(result.matchScore).toBe(0);
  });

  it("does not treat an unquantified senior title as a numeric experience blocker", () => {
    const result = matcher.evaluate(job("React, TypeScript and frontend engineering experience.", "Senior Frontend Engineer"), profile);
    expect(result.decision).not.toBe("REJECT");
    expect(result.evidence).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "HARD_BLOCKER", detail: expect.stringMatching(/experience requirement/i) })]));
  });

  it("does not hard-reject preferred experience", () => {
    const result = matcher.evaluate(job("React and TypeScript. 5 years of experience preferred."), profile);
    expect(result.evidence).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "HARD_BLOCKER" })]));
    expect(result.decision).not.toBe("REJECT");
  });

  it("can distinguish a low-overlap role", () => {
    const result = matcher.evaluate(job("Java, Spring Boot, Kafka and Kubernetes experience required.", "Backend Engineer"), profile);
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBeLessThan(40);
  });

  it("rejects marketing even when the posting mentions frontend technologies", () => {
    const result = matcher.evaluate(job("Own product marketing campaigns. Familiarity with React and TypeScript is helpful.", "Product Marketing Manager"), profile);
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ type: "HARD_BLOCKER" })]));
  });

  it("rejects AI/ML engineering when frontend work is not part of the role", () => {
    const result = matcher.evaluate(job("Build machine learning models, training pipelines and inference systems with Python and PyTorch. React dashboards are owned by another team.", "AI Engineer"), profile);
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });

  it("accepts a genuine full-stack React role", () => {
    const result = matcher.evaluate(job("Build customer-facing React and Next.js interfaces and Node.js APIs in a full-stack team.", "Full Stack Engineer"), profile);
    expect(result.decision).toBe("APPLY");
    expect(result.matchedSkills).toEqual(expect.arrayContaining(["React", "Next.js", "Node.js"]));
  });

  it("does not penalize unrelated resume skills enough to reject a strong frontend role", () => {
    const broadProfile: CandidateProfile = {
      ...profile,
      skills: [
        "React", "Next.js", "TypeScript", "JavaScript", "Redux Toolkit",
        "Tailwind CSS", "Node.js", "Express.js", "MongoDB", "Docker",
        "Git", "Jest", "React Testing Library", "REST APIs"
      ]
    };

    const result = matcher.evaluate(
      job("Build and maintain a React and TypeScript frontend with Next.js. JavaScript experience required."),
      broadProfile
    );

    expect(result.matchedSkills).toEqual(expect.arrayContaining(["React", "Next.js", "TypeScript", "JavaScript"]));
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(result.decision).toBe("APPLY");
  });
  it("does not auto-apply a worldwide remote role without India eligibility", () => {
    const worldwide: JobOpportunity = {
      ...job("React, Next.js and TypeScript are required. Remote worldwide."),
      location: "Worldwide",
      country: null,
      workplaceType: "remote"
    };
    const result = matcher.evaluate(worldwide, profile);
    expect(result.geography).toBe("REMOTE_WORLDWIDE");
    expect(result.decision).toBe("REVIEW");
  });

  it("rejects a remote role explicitly restricted to a foreign country in the title", () => {
    const result = matcher.evaluate(job("Remote full-stack React role for Canada.", "Remote Full Stack Developer - Canada"), profile);
    expect(result.decision).toBe("REJECT");
    expect(result.reason).toContain("India");
  });

  it("rejects a WordPress-primary role even when frontend skills are mentioned", () => {
    const result = matcher.evaluate(
      job("Maintain WordPress sites and plugins. React knowledge is helpful for UI work.", "Senior Software Engineer, WordPress"),
      profile
    );
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });

  it("rejects a .NET/C#-primary developer role even when React is mentioned incidentally", () => {
    const result = matcher.evaluate(
      job("Build .NET and C# services. React is mentioned for occasional frontend integration.", "Senior .NET/C# Developer"),
      profile
    );
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });

  it("does not treat incidental React in a SharePoint-primary role as frontend work", () => {
    const result = matcher.evaluate(job("Build Microsoft 365 and SharePoint solutions. React knowledge is helpful for occasional UI work.", "Microsoft 365 Software Engineer - SharePoint Developer"), profile);
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });

});
