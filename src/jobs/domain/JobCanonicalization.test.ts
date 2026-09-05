import { canonicalizeJobUrl, createCanonicalJobId } from "./JobCanonicalization";

describe("job canonicalization", () => {
  test("removes query string and fragment while preserving the job path", () => {
    expect(
      canonicalizeJobUrl("https://example.com/jobs/frontend?id=123#details")
    ).toBe("https://example.com/jobs/frontend");
  });

  test("produces the same canonical id for tracking parameters", () => {
    expect(
      createCanonicalJobId("https://example.com/jobs/frontend?utm_source=linkedin")
    ).toBe(createCanonicalJobId("https://example.com/jobs/frontend"));
  });

  test("preserves case-sensitive URL paths", () => {
    expect(
      canonicalizeJobUrl("https://example.com/Jobs/Frontend")
    ).toBe("https://example.com/Jobs/Frontend");
    expect(
      createCanonicalJobId("https://example.com/Jobs/Frontend")
    ).not.toBe(createCanonicalJobId("https://example.com/jobs/frontend"));
  });
});
