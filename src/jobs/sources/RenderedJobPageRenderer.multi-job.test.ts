import { normalizeVisibleJobCandidates } from "./RenderedJobPageRenderer";

const candidate = (id: number, company = `Company ${id}`) => ({
  title: `React Job ${id}`,
  company,
  description: `Build React applications for ${company} with TypeScript and modern frontend tooling.`,
  url: `https://example.com/job/${id}`
});

describe("rendered multi-job normalization", () => {
  it("preserves three DOM-extracted job cards", () => {
    expect(normalizeVisibleJobCandidates([candidate(1), candidate(2), candidate(3)])).toHaveLength(3);
  });

  it("preserves ten DOM-extracted job cards", () => {
    const jobs = Array.from({ length: 10 }, (_, index) => candidate(index + 1));
    expect(normalizeVisibleJobCandidates(jobs)).toHaveLength(10);
  });

  it("deduplicates duplicate representations of the same rendered job", () => {
    expect(normalizeVisibleJobCandidates([candidate(1), candidate(1, "Same Company"), candidate(2)])).toHaveLength(2);
  });

  it("retains valid jobs while unrelated links are excluded before normalization", () => {
    const jobs = [candidate(1), candidate(2)];
    expect(normalizeVisibleJobCandidates(jobs).map((job) => job.url)).toEqual([
      "https://example.com/job/1",
      "https://example.com/job/2"
    ]);
  });
});
