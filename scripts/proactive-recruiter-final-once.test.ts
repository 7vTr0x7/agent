import { boundedEnv } from "./proactive-recruiter-final-once";

describe("final proactive recruiter runtime bounds", () => {
  afterEach(() => {
    delete process.env.PROACTIVE_RECRUITER_MAX_QUERIES;
    delete process.env.PROACTIVE_RECRUITER_JOB_LINKED_LIMIT;
    delete process.env.PUBLIC_HIRING_POST_MAX_QUERIES;
  });

  it("clamps recruiter fan-out to the final runtime bounds", () => {
    process.env.PROACTIVE_RECRUITER_MAX_QUERIES = "99";
    process.env.PROACTIVE_RECRUITER_JOB_LINKED_LIMIT = "99";
    process.env.PUBLIC_HIRING_POST_MAX_QUERIES = "99";

    expect(boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 2, 2)).toBe("2");
    expect(boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 1)).toBe("1");
    expect(boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 1, 1)).toBe("1");
  });

  it("falls back safely for invalid values", () => {
    process.env.PROACTIVE_RECRUITER_MAX_QUERIES = "not-a-number";
    expect(boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 2, 2)).toBe("2");
  });
});
