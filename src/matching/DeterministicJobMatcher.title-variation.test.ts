import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";

const profile: CandidateProfile = {
  id: "candidate-title-variation",
  yearsExperience: 3,
  skills: ["React", "Next.js", "JavaScript", "TypeScript", "Redux Toolkit", "Node.js", "Express.js", "MongoDB", "REST APIs", "HTML/CSS", "Tailwind CSS", "Jest"],
  targetTitles: ["Frontend Engineer", "Frontend Developer", "React Developer", "Next.js Developer", "Full Stack Engineer"]
};

function job(title: string, description: string, location = "Pune"): JobOpportunity {
  return {
    id: `job-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    canonicalId: `canonical-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    canonicalUrl: "https://example.com/job",
    title,
    companyName: "Example",
    location,
    country: "India",
    workplaceType: "onsite",
    employmentType: "full-time",
    description,
    postedAt: new Date("2026-09-28T08:00:00Z"),
    sourceUpdatedAt: null,
    lastSeenAt: new Date(),
    closedAt: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

describe("DeterministicJobMatcher title variation", () => {
  const matcher = new DeterministicJobMatcher();

  it("matches Customer Software Engineer when responsibilities are frontend React/Next.js", () => {
    const result = matcher.evaluate(job(
      "Customer Software Engineer",
      "Build and maintain customer-facing web applications using React, Next.js, TypeScript and JavaScript. Develop reusable UI components, integrate REST APIs, use Redux/state management, implement responsive interfaces, write Jest tests and collaborate with backend teams."
    ), profile);

    expect(result.technicalOrientation).toBe("FRONTEND");
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ type: "ROLE_FIT" })]));
    expect(result.decision).toBe("APPLY");
  });

  it("matches Application Developer - Front End from responsibilities rather than exact title", () => {
    const result = matcher.evaluate(job(
      "Application Developer - Front End",
      "Own production frontend features using TypeScript and React 18. Build reusable components, React Hooks and state management, integrate REST APIs and OAuth, handle loading and error states, optimize Core Web Vitals, build responsive mobile-first UI, and test with Jest, React Testing Library and Playwright."
    ), profile);

    expect(result.technicalOrientation).toBe("REACT_WEB");
    expect(result.decision).toBe("APPLY");
  });

  it("can recognize an unusual product title when the actual work is software development", () => {
    const result = matcher.evaluate(job(
      "Senior Product Analyst",
      "Work directly on a product engineering team to build user-facing React and Next.js dashboards. Develop TypeScript components, integrate REST APIs, implement Redux state management, create responsive UI, debug production issues, and own features from design through production."
    ), profile);

    expect(result.technicalOrientation).toBe("FRONTEND");
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ type: "ROLE_FIT" })]));
    expect(result.decision).toBe("APPLY");
  });

  it("does not turn an analyst title into a frontend match from skills alone", () => {
    const result = matcher.evaluate(job(
      "Senior Product Analyst",
      "Analyze product KPIs, build business reports, prepare SQL analysis, create dashboards in BI tools, conduct stakeholder research and present findings. React and TypeScript familiarity is a nice-to-have only."
    ), profile);

    expect(result.decision).toBe("REJECT");
  });

  it("keeps experience and eligibility gates authoritative for title variations", () => {
    const result = matcher.evaluate(job(
      "Customer Software Engineer",
      "Build React and Next.js applications with TypeScript. Must have 5+ years of frontend engineering experience. Pune office."
    ), profile);

    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });
});
