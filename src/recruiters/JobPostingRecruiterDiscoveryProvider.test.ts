import { JobPostingRecruiterDiscoveryProvider, extractExplicitRecruiterEmails } from "./JobPostingRecruiterDiscoveryProvider";

describe("JobPostingRecruiterDiscoveryProvider", () => {
  it("extracts only same-domain emails in recruiting context", () => {
    const description = `Apply by contacting talent@Example.com. For technical questions email engineering@example.com. Recruiter: hiring@example.com. External: recruiter@gmail.com.`;
    expect(extractExplicitRecruiterEmails(description, "https://www.example.com/jobs/frontend")).toEqual(["talent@example.com", "hiring@example.com"]);
  });

  it("deduplicates addresses and ignores unrelated company emails", () => {
    const description = `Careers: talent@example.com\nRecruiting: TALENT@example.com\nSupport: support@example.com`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual(["talent@example.com"]);
  });

  it("recognizes obfuscated recruiting emails and mailto links", () => {
    const description = `Recruiting: talent [at] example [dot] com. <a href="mailto:careers@example.com">Careers</a>`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual(["talent@example.com", "careers@example.com"]);
  });

  it("accepts a recruiting mailbox alias even when the nearby HTML has no keyword", () => {
    const description = `<a href="mailto:jobs@example.com">Apply for this role</a>`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual(["jobs@example.com"]);
  });

  it("marks public posting addresses unverified", async () => {
    const provider = new JobPostingRecruiterDiscoveryProvider();
    const result = await provider.discover({
      companyName: "Example",
      companyDomain: "example.com",
      jobTitle: "Frontend Engineer",
      jobDescription: "Please contact careers@example.com for recruiting questions.",
      candidateProfileId: "candidate-1"
    });

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({
      email: "careers@example.com",
      verified: false,
      confidence: 100,
      verificationStatus: "unverified_public_source"
    });
  });
});
