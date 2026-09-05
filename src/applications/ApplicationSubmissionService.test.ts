import { createServer, Server } from "node:http";
import { BrowserSessionService } from "./BrowserSession";
import { ApplicationAdapter, ApplicationAdapterRegistry, ApplicationContext } from "./ApplicationAdapter";
import { ApplicationSubmissionService } from "./ApplicationSubmissionService";
import { CandidateProfile } from "../candidates/CandidateProfile";

class RecordingAdapter implements ApplicationAdapter {
  readonly name = "recording-adapter";
  submitted = false;

  canHandle(url: string): boolean {
    return /^http:\/\/127\.0\.0\.1:/i.test(url);
  }

  async submit(): Promise<{
    submitted: boolean;
    externalApplicationId: string | null;
    confirmationUrl: string | null;
    reason: string;
  }> {
    this.submitted = true;
    return {
      submitted: true,
      externalApplicationId: "external-1",
      confirmationUrl: "http://127.0.0.1/confirmation",
      reason: "Synthetic submission completed."
    };
  }
}

describe("ApplicationSubmissionService", () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <form>
          <label for="first-name">First Name</label>
          <input id="first-name" name="first_name" type="text" required />
          <label for="email">Email Address</label>
          <input id="email" name="email" type="email" required />
          <label for="experience">Years of experience</label>
          <input id="experience" name="experience" type="text" required />
        </form>
      `);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
    url = `http://127.0.0.1:${address.port}/apply`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("fills safe fields but refuses to submit when a required unsafe field remains unresolved", async () => {
    const adapter = new RecordingAdapter();
    const service = new ApplicationSubmissionService(
      new BrowserSessionService({ headless: true }),
      new ApplicationAdapterRegistry([adapter])
    );

    const context: ApplicationContext = {
      jobOpportunityId: "job-1",
      candidateProfileId: "candidate-1",
      applicationId: "application-1",
      url
    };

    const profile: CandidateProfile = {
      id: "candidate-1",
      yearsExperience: 3,
      skills: ["React", "TypeScript"],
      targetTitles: ["Frontend Engineer"],
      firstName: "Salman",
      email: "salman@example.com"
    };

    const result = await service.submit({
      context,
      companyName: "Example Corp",
      excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
      candidateProfile: profile
    });

    expect(result.submitted).toBe(false);
    expect(result.safetyAllowed).toBe(false);
    expect(result.reason).toContain("Years of experience");
    expect(adapter.submitted).toBe(false);
  });
});
