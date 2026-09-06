import {
  AshbyApplicationAdapter,
  BambooHrApplicationAdapter,
  GreenhouseApplicationAdapter,
  IcimsApplicationAdapter,
  JazzHrApplicationAdapter,
  JobviteApplicationAdapter,
  LeverApplicationAdapter,
  PinpointApplicationAdapter,
  RecruiteeApplicationAdapter,
  SmartRecruitersApplicationAdapter,
  TeamtailorApplicationAdapter,
  WorkableApplicationAdapter
} from "./AtsApplicationAdapters";

const cases = [
  [GreenhouseApplicationAdapter, "https://job-boards.greenhouse.io/acme/jobs/123"],
  [LeverApplicationAdapter, "https://jobs.lever.co/acme/123"],
  [AshbyApplicationAdapter, "https://jobs.ashbyhq.com/acme/123"],
  [WorkableApplicationAdapter, "https://apply.workable.com/acme/j/ABC/"],
  [SmartRecruitersApplicationAdapter, "https://jobs.smartrecruiters.com/Acme/123"],
  [BambooHrApplicationAdapter, "https://acme.bamboohr.com/careers/123"],
  [TeamtailorApplicationAdapter, "https://acme.teamtailor.com/jobs/123"],
  [RecruiteeApplicationAdapter, "https://acme.recruitee.com/l/123"],
  [JobviteApplicationAdapter, "https://jobs.jobvite.com/acme/job/123"],
  [IcimsApplicationAdapter, "https://careers-acme.icims.com/jobs/123/job"],
  [PinpointApplicationAdapter, "https://acme.pinpointhq.com/postings/123"],
  [JazzHrApplicationAdapter, "https://acme.jazz.co/jobs/123"]
] as const;

describe("hosted ATS application adapters", () => {
  test.each(cases)("recognizes %p", (Adapter, url) => {
    expect(new Adapter().canHandle(url)).toBe(true);
  });

  test("does not claim unrelated sites", () => {
    const adapters = cases.map(([Adapter]) => new Adapter());
    for (const adapter of adapters) {
      expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
      expect(adapter.canHandle("not-a-url")).toBe(false);
    }
  });

  test("keeps ATS matching host-specific", () => {
    expect(new GreenhouseApplicationAdapter().canHandle("https://greenhouse.io/jobs/123")).toBe(false);
    expect(new LeverApplicationAdapter().canHandle("https://lever.com/jobs/123")).toBe(false);
    expect(new WorkableApplicationAdapter().canHandle("https://workable.com/jobs/123")).toBe(false);
  });
});
