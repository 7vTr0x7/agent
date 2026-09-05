import { PostgresTailoredResumeRepository, TailoredResumeRecord } from "./TailoredResumeRepository";
import { Database } from "../database/Database";

function record(): TailoredResumeRecord {
  return {
    applicationId: "application-1",
    jobOpportunityId: "job-1",
    candidateProfileId: "candidate-1",
    jobTitle: "Frontend Engineer",
    sourceVersion: "master-resume-v1",
    resumePath: "/data/resumes/frontend-engineer.pdf",
    atsScore: 88,
    matchedKeywords: ["react", "typescript"],
    missingKeywords: ["aws"],
    warnings: ["AWS was not invented."]
  };
}

describe("PostgresTailoredResumeRepository", () => {
  it("persists all tailored resume audit metadata with an application-level idempotency key", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const database = { query } as unknown as Database;
    const repository = new PostgresTailoredResumeRepository(database);

    await repository.save(record());

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO tailored_resume_versions");
    expect(sql).toContain("ON CONFLICT (application_id)");
    expect(values).toEqual([
      "application-1",
      "job-1",
      "candidate-1",
      "Frontend Engineer",
      "master-resume-v1",
      "/data/resumes/frontend-engineer.pdf",
      88,
      JSON.stringify(["react", "typescript"]),
      JSON.stringify(["aws"]),
      JSON.stringify(["AWS was not invented."])
    ]);
  });
});
