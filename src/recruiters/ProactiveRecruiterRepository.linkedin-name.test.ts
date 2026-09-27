import { normalizeRecruiterNameForLinkedIn } from "./ProactiveRecruiterRepository";

describe("normalizeRecruiterNameForLinkedIn", () => {
  it("keeps a name consistent with the LinkedIn slug", () => {
    expect(normalizeRecruiterNameForLinkedIn("Jane Recruiter", "https://www.linkedin.com/in/jane-recruiter")).toBe("Jane Recruiter");
  });

  it("uses the LinkedIn slug when public snippet text attributed the wrong person name", () => {
    expect(normalizeRecruiterNameForLinkedIn("Other Person", "https://www.linkedin.com/in/jane-recruiter-12345")).toBe("Jane Recruiter");
  });

  it("does not invent a name from an unusable slug", () => {
    expect(normalizeRecruiterNameForLinkedIn("Other Person", "https://www.linkedin.com/in/x")).toBe("Other Person");
  });
});
