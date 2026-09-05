import { ApplicationFieldMapper } from "./ApplicationFieldMapper";
import { ApplicationField } from "./FormFieldDetector";
import { CandidateProfile } from "../candidates/CandidateProfile";

describe("ApplicationFieldMapper", () => {
  const profile: CandidateProfile = {
    id: "candidate-1",
    yearsExperience: 3,
    skills: ["React.js", "TypeScript"],
    targetTitles: ["Frontend Engineer"],
    firstName: "Salman",
    lastName: "Shaikh",
    email: "salman@example.com",
    phone: "+919999999999",
    location: "Bengaluru, India",
    linkedinUrl: "https://linkedin.com/in/example",
    githubUrl: "https://github.com/example",
    resumePath: "/home/user/resume.pdf"
  };

  it("maps high-confidence safe fields", () => {
    const fields: ApplicationField[] = [
      { name: "first_name", type: "text", required: true, label: "First Name", placeholder: null },
      { name: "email", type: "email", required: true, label: "Email Address", placeholder: null },
      { name: "linkedin", type: "url", required: false, label: "LinkedIn Profile", placeholder: null }
    ];

    const result = new ApplicationFieldMapper().map(fields, profile);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "firstName", value: "Salman", confidence: 1, autoFill: true }),
      expect.objectContaining({ key: "email", value: "salman@example.com", confidence: 1, autoFill: true }),
      expect.objectContaining({ key: "linkedinUrl", value: "https://linkedin.com/in/example", autoFill: true })
    ]));
  });

  it("refuses ambiguous required fields", () => {
    const fields: ApplicationField[] = [
      { name: "name_or_email", type: "text", required: true, label: "Name / Email", placeholder: null }
    ];

    const [mapping] = new ApplicationFieldMapper().map(fields, profile);

    expect(mapping.key).toBeNull();
    expect(mapping.autoFill).toBe(false);
    expect(mapping.reason).toContain("manual review");
  });

  it("does not automatically answer policy-sensitive fields", () => {
    const fields: ApplicationField[] = [
      { name: "sponsorship", type: "radio", required: true, label: "Will you require visa sponsorship?", placeholder: null },
      { name: "experience", type: "text", required: true, label: "Years of experience", placeholder: null }
    ];

    const [sponsorship, experience] = new ApplicationFieldMapper().map(fields, profile);

    expect(sponsorship.key).toBe("sponsorshipRequired");
    expect(sponsorship.autoFill).toBe(false);
    expect(experience.key).toBe("yearsExperience");
    expect(experience.autoFill).toBe(false);
  });

  it("never auto-fills an unsupported required field", () => {
    const fields: ApplicationField[] = [
      { name: "favorite_framework", type: "text", required: true, label: "Favorite Framework", placeholder: null }
    ];

    const [mapping] = new ApplicationFieldMapper().map(fields, profile);

    expect(mapping.key).toBeNull();
    expect(mapping.value).toBeNull();
    expect(mapping.autoFill).toBe(false);
  });
});
