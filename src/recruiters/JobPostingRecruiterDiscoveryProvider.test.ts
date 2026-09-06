import { JobPostingRecruiterDiscoveryProvider, extractExplicitRecruiterEmails } from "./JobPostingRecruiterDiscoveryProvider";

describe("JobPostingRecruiterDiscoveryProvider", () => {
  it("extracts only same-domain emails in recruiting context", () => {
    const description = `Apply by contacting talent@Example.com. For technical questions email engineering@example.com. Recruiter: hiring@example.com. External: recruiter@gmail.com.`;

    expect(extractExplicitRecruiterEmails(description, "https://www.example.com/jobs/frontend")).toEqual([
      "talent@example.com",
      "hiring@example.com"
    ]);
  });

  it("deduplicates addresses and ignores unrelated company emails", () => {
    const description = `Careers: talent@example.com\nRecruiting: TALENT@example.com\nSupport: support@example.com`;
    expect(extractExplicitRecruiterEmails(description, "example.com")).toEqual(["talent@example.com"]);
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
