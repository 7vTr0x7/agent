import { evaluateJobEligibility, JobSearchPolicy } from "./JobEligibility";
import { Job } from "../domain/Job";

const policy: JobSearchPolicy = {
  priorityLocations: ["Bangalore", "Bengaluru"],
  targetCountry: "India",
  allowRemote: true,
  excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
  maxAgeDays: 7,
  targetTitles: ["Frontend Engineer", "Frontend Developer", "Full Stack Engineer"],
  candidateSkills: ["React.js", "Next.js", "JavaScript", "TypeScript", "Redux Toolkit", "Node.js", "Express.js", "MongoDB"],
  yearsExperience: 3,
  minPersistenceRelevance: 45
};

function job(overrides: Partial<Job>): Job {
  return {
    source: "test", sourceJobId: "1", url: "https://example.com/job", title: "Frontend Engineer", companyName: "Example Company",
    location: "Bangalore, India", country: "India", workplaceType: "onsite", employmentType: "Full-time", description: "React TypeScript",
    postedAt: null, updatedAt: null, contentHash: "test", ...overrides
  };
}

describe("evaluateJobEligibility", () => {
  test("Bangalore gets highest priority", () => expect(evaluateJobEligibility(job({ location: "Bengaluru, Karnataka, India" }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 1 }));
  test("other India location is eligible with lower priority", () => expect(evaluateJobEligibility(job({ location: "Pune, Maharashtra, India" }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 2 }));
  test("remote worldwide is eligible", () => expect(evaluateJobEligibility(job({ location: "Remote - Worldwide", country: null, workplaceType: "remote", description: "React TypeScript frontend" }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 3 }));
  test("remote India is eligible", () => expect(evaluateJobEligibility(job({ title: "React Developer", location: "Remote - India", country: "India", workplaceType: "remote", description: "React TypeScript" }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 3 }));
  test("excluded companies are rejected", () => {
    expect(evaluateJobEligibility(job({ companyName: "Octopus Technologies" }), policy)).toMatchObject({ decision: "REJECT", priority: null });
    expect(evaluateJobEligibility(job({ companyName: "Sketch Brahma Technologies" }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });
  test("outside-India onsite role is rejected", () => expect(evaluateJobEligibility(job({ location: "London, United Kingdom", country: "United Kingdom" }), policy)).toMatchObject({ decision: "REJECT", priority: null }));
  test("foreign remote-only restrictions are rejected", () => {
    expect(evaluateJobEligibility(job({ title: "Frontend Engineer", location: "Remote - US only", country: "United States", workplaceType: "remote", description: "React TypeScript" }), policy)).toMatchObject({ decision: "REJECT", priority: null });
    expect(evaluateJobEligibility(job({ title: "React Developer", location: "Remote - Canada", country: "Canada", workplaceType: "remote", description: "React TypeScript" }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });
  test("stale and future posted jobs are rejected", () => {
    expect(evaluateJobEligibility(job({ postedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }), policy)).toMatchObject({ decision: "REJECT", priority: null });
    expect(evaluateJobEligibility(job({ postedAt: new Date(Date.now() + 60 * 60 * 1000) }), policy)).toMatchObject({ decision: "REJECT", priority: null });
  });
  test("unknown posted date remains eligible", () => expect(evaluateJobEligibility(job({ postedAt: null }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 1 }));
  test("remote is rejected when remote work is disabled", () => expect(evaluateJobEligibility(job({ location: "Remote", country: null, workplaceType: "remote" }), { ...policy, allowRemote: false })).toMatchObject({ decision: "REJECT", priority: null }));
  test("high-risk payment request is rejected", () => expect(evaluateJobEligibility(job({ title: "Remote Frontend Engineer", description: "Pay a registration fee before the interview." }), policy)).toMatchObject({ decision: "REJECT", priority: null }));
  test("medium-risk messaging language remains eligible with a warning", () => expect(evaluateJobEligibility(job({ description: "Contact only via Telegram to proceed." }), policy)).toMatchObject({ decision: "ELIGIBLE", priority: 1, reason: expect.stringContaining("medium-risk warning") }));

  const mustReject = [
    "Remote AI Engineer", "System Engineer", "DevOps Engineer", "SRE", "Data Engineer", "Data Scientist", "Network Engineer", "Network Administrator",
    "Hardware Engineer", "Influencer Marketing Manager", "Payroll Specialist", "Chief of Staff", "Account Manager", "Graphic Designer", "Course Writer",
    "Education Designer", "Windows Endpoint Engineer", "macOS Engineer", "Marketing Manager", "Customer Support"
  ];
  test.each(mustReject)("rejects clearly irrelevant role: %s", (title) => {
    const result = evaluateJobEligibility(job({ title, description: "General responsibilities with no frontend, React, JavaScript, TypeScript, or web application work." }), policy);
    expect(result.decision).toBe("REJECT");
    expect(result.classification).toBe("IRRELEVANT");
  });

  const mustAccept = [
    "React Developer", "Frontend Developer", "Frontend Engineer", "Senior React Developer", "Next.js Developer", "React + Node.js Developer",
    "Full Stack Developer — React", "Full Stack Engineer — TypeScript / React", "MERN Stack Developer", "TypeScript Frontend Engineer",
    "Software Engineer — Frontend", "Web Developer — React"
  ];
  test.each(mustAccept)("accepts target role: %s", (title) => {
    const result = evaluateJobEligibility(job({ title, description: "Build web applications using React, TypeScript, JavaScript and Node.js." }), policy);
    expect(result.decision).toBe("ELIGIBLE");
  });
  test("generic software engineer without frontend evidence is not persisted", () => expect(evaluateJobEligibility(job({ title: "Software Engineer", description: "Backend services, distributed systems, data processing and infrastructure." }), policy).decision).toBe("REJECT"));
  test("full-stack without frontend evidence is not persisted", () => expect(evaluateJobEligibility(job({ title: "Full Stack Developer", description: "Backend APIs, Java, Spring Boot, Kafka and PostgreSQL." }), policy).decision).toBe("REJECT"));
  test("senior frontend with 3+ years remains eligible", () => expect(evaluateJobEligibility(job({ title: "Senior Frontend Engineer", description: "3+ years required. React, TypeScript and web applications." }), policy).decision).toBe("ELIGIBLE"));
  test("leadership and 10+ year roles are rejected", () => {
    expect(evaluateJobEligibility(job({ title: "Staff Frontend Engineer", description: "React, 8+ years." }), policy).decision).toBe("REJECT");
    expect(evaluateJobEligibility(job({ title: "Principal React Engineer", description: "React, 10+ years." }), policy).decision).toBe("REJECT");
    expect(evaluateJobEligibility(job({ title: "Frontend Engineer", description: "React, 10+ years required." }), policy).decision).toBe("REJECT");
  });
});
