import { ResumeProfile } from "./ResumeProfile";
import { ResumeTailoringService } from "./ResumeTailoringService";

const resume: ResumeProfile = {
  name: "Candidate",
  summary: "Frontend engineer building React and TypeScript applications.",
  skills: ["React", "TypeScript", "Next.js", "Node.js", "MongoDB"],
  experience: [
    {
      company: "Example Corp",
      title: "Frontend Engineer",
      startDate: "2024-01",
      bullets: [
        "Built React and TypeScript applications with reusable components.",
        "Integrated REST APIs and improved frontend performance.",
        "Worked with MongoDB-backed Node.js services."
      ]
    },
    {
      company: "Earlier Corp",
      title: "Software Developer",
      startDate: "2022-01",
      bullets: ["Maintained web applications and fixed production issues."]
    }
  ],
  education: [
    { institution: "University", degree: "BCA" }
  ]
};

describe("ResumeTailoringService", () => {
  it("prioritizes supported JD keywords without inventing unsupported skills", () => {
    const result = new ResumeTailoringService().tailor({
      resume,
      jobTitle: "Frontend Engineer",
      jobDescription: "React TypeScript Next.js AWS Kubernetes experience required.",
      sourceVersion: "master-1"
    });

    expect(result.atsScore).toBeGreaterThan(50);
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(["react", "typescript", "next.js"]));
    expect(result.missingKeywords).toEqual(expect.arrayContaining(["aws", "kubernetes"]));
    expect(result.skills[0]).toBe("React");
    expect(result.warnings.join(" ")).toContain("not invented");
  });

  it("keeps the master resume as the source of truth", () => {
    const result = new ResumeTailoringService().tailor({
      resume,
      jobTitle: "Backend Engineer",
      jobDescription: "Python Django PostgreSQL required.",
      sourceVersion: "master-1"
    });

    expect(result.summary).toBe(resume.summary);
    expect(result.experience).toHaveLength(resume.experience.length);
    expect(result.matchedKeywords).not.toEqual(expect.arrayContaining(["python", "django", "postgresql"]));
  });
});
