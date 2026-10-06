import { boundedEnv, buildRuntimeEnv, FINAL_RUNTIME_SCRIPTS } from "./proactive-recruiter-final-once";

describe("final proactive recruiter runtime bounds", () => {
  afterEach(() => {
    delete process.env.PROACTIVE_RECRUITER_MAX_QUERIES;
    delete process.env.PROACTIVE_RECRUITER_JOB_LINKED_LIMIT;
    delete process.env.PUBLIC_HIRING_POST_MAX_QUERIES;
    delete process.env.PROACTIVE_RECRUITER_SEND_ENABLED;
    delete process.env.OUTBOUND_ENABLED;
    delete process.env.GMAIL_ENABLED;
    delete process.env.PROACTIVE_RECRUITER_QUERY_OFFSET;
  });

  it("clamps recruiter fan-out to the final runtime bounds", () => {
    process.env.PROACTIVE_RECRUITER_MAX_QUERIES = "99";
    process.env.PROACTIVE_RECRUITER_JOB_LINKED_LIMIT = "99";
    process.env.PUBLIC_HIRING_POST_MAX_QUERIES = "99";

    expect(boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 4, 4)).toBe("4");
    expect(boundedEnv("PROACTIVE_RECRUITER_JOB_LINKED_LIMIT", 1, 1)).toBe("1");
    expect(boundedEnv("PUBLIC_HIRING_POST_MAX_QUERIES", 2, 2)).toBe("2");
  });

  it("falls back safely for invalid values", () => {
    process.env.PROACTIVE_RECRUITER_MAX_QUERIES = "not-a-number";
    expect(boundedEnv("PROACTIVE_RECRUITER_MAX_QUERIES", 4, 4)).toBe("4");
  });

  it("keeps fresh discovery in the final runtime before contact-first outreach", () => {
    expect(FINAL_RUNTIME_SCRIPTS).toEqual([
      "scripts/proactive-recruiter-once.ts",
      "scripts/proactive-recruiter-contact-first-once.ts"
    ]);
  });

  it("propagates the rotating discovery offset without enabling outbound sends", () => {
    process.env.PROACTIVE_RECRUITER_QUERY_OFFSET = "7";
    process.env.PROACTIVE_RECRUITER_SEND_ENABLED = "true";
    process.env.OUTBOUND_ENABLED = "true";
    process.env.GMAIL_ENABLED = "true";

    const env = buildRuntimeEnv();

    expect(env.PROACTIVE_RECRUITER_QUERY_OFFSET).toBe("7");
    expect(env.PROACTIVE_RECRUITER_SEND_ENABLED).toBe("false");
    expect(env.OUTBOUND_ENABLED).toBe("false");
    expect(env.GMAIL_ENABLED).toBe("false");
  });

  it("enables discovery for the explicit once command while hard-disabling outbound side effects", () => {
    process.env.PROACTIVE_RECRUITER_SEND_ENABLED = "true";
    process.env.OUTBOUND_ENABLED = "true";
    process.env.GMAIL_ENABLED = "true";

    const env = buildRuntimeEnv();

    expect(env.PROACTIVE_RECRUITER_ENABLED).toBe("true");
    expect(env.PROACTIVE_RECRUITER_SEND_ENABLED).toBe("false");
    expect(env.RECRUITER_OUTREACH_DRY_RUN).toBe("true");
    expect(env.RECRUITER_OUTREACH_ACTIVATION).toBe("disabled");
    expect(env.RECRUITER_LIVE_ACTIVATION_CONFIRMED).toBe("false");
    expect(env.AUTOMATION_ENABLED).toBe("false");
    expect(env.GMAIL_ENABLED).toBe("false");
    expect(env.OUTBOUND_ENABLED).toBe("false");
    expect(env.APPLICATION_DRY_RUN).toBe("true");
    expect(env.APPLICATION_LIVE_ENABLED).toBe("false");
  });
});
