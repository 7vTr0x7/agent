import {
  ApnaApplicationAdapter, AshbyApplicationAdapter, BambooHrApplicationAdapter, BizReachApplicationAdapter,
  BuiltInApplicationAdapter, CanadaJobBankApplicationAdapter, CareerCrossApplicationAdapter, CutshortApplicationAdapter,
  DaijobApplicationAdapter, DiceApplicationAdapter, ElutaApplicationAdapter, EnJapanApplicationAdapter, FounditApplicationAdapter,
  FlexJobsApplicationAdapter, FreshersworldApplicationAdapter, GaijinPotApplicationAdapter, GlintsApplicationAdapter,
  GreenJapanApplicationAdapter, GreenhouseApplicationAdapter, HackerNewsApplicationAdapter, HerKeyApplicationAdapter,
  HirectApplicationAdapter, HimalayasApplicationAdapter, HiristApplicationAdapter, IimJobsApplicationAdapter,
  IcimsApplicationAdapter, IndeedApplicationAdapter, InstahyreApplicationAdapter, InternshalaApplicationAdapter,
  JazzHrApplicationAdapter, JobillicoApplicationAdapter, JobStreetApplicationAdapter, JobsDbApplicationAdapter,
  JobsGcApplicationAdapter, JobviteApplicationAdapter, LinkedInApplicationAdapter, LeverApplicationAdapter,
  MyCareersFutureApplicationAdapter, MynaviApplicationAdapter, NaukriApplicationAdapter, OracleCloudApplicationAdapter,
  PinpointApplicationAdapter, RecruiteeApplicationAdapter, RemotiveApplicationAdapter, RemoteOkApplicationAdapter,
  RikunabiApplicationAdapter, ShineApplicationAdapter, SmartRecruitersApplicationAdapter, SuccessFactorsApplicationAdapter,
  TaleoApplicationAdapter, TeamtailorApplicationAdapter, TimesJobsApplicationAdapter, UkGApplicationAdapter,
  WantedlyApplicationAdapter, WeWorkRemotelyApplicationAdapter, WelcomeToTheJungleApplicationAdapter, WorkableApplicationAdapter,
  WorkIndiaApplicationAdapter, WorkdayApplicationAdapter, WorkingNomadsApplicationAdapter, WorkopolisApplicationAdapter,
  WowJobsApplicationAdapter, YCombinatorApplicationAdapter, WellfoundApplicationAdapter, FastJobsApplicationAdapter,
  createHostedAtsApplicationAdapters
} from "./AtsApplicationAdapters";

const cases = [
  [GreenhouseApplicationAdapter, "https://job-boards.greenhouse.io/acme/jobs/123"], [LeverApplicationAdapter, "https://jobs.lever.co/acme/123"],
  [AshbyApplicationAdapter, "https://jobs.ashbyhq.com/acme/123"], [WorkableApplicationAdapter, "https://apply.workable.com/acme/j/ABC/"],
  [SmartRecruitersApplicationAdapter, "https://jobs.smartrecruiters.com/Acme/123"], [BambooHrApplicationAdapter, "https://acme.bamboohr.com/careers/123"],
  [TeamtailorApplicationAdapter, "https://acme.teamtailor.com/jobs/123"], [RecruiteeApplicationAdapter, "https://acme.recruitee.com/l/123"],
  [JobviteApplicationAdapter, "https://jobs.jobvite.com/acme/job/123"], [IcimsApplicationAdapter, "https://careers-acme.icims.com/jobs/123/job"],
  [PinpointApplicationAdapter, "https://acme.pinpointhq.com/postings/123"], [JazzHrApplicationAdapter, "https://acme.jazz.co/jobs/123"],
  [WorkdayApplicationAdapter, "https://acme.myworkdayjobs.com/en-US/jobs/job/123"], [TaleoApplicationAdapter, "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=123"],
  [SuccessFactorsApplicationAdapter, "https://acme.successfactors.com/career/job/123"], [UkGApplicationAdapter, "https://recruiting.ultipro.com/acme/job/123"],
  [OracleCloudApplicationAdapter, "https://acme.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123"],
  [NaukriApplicationAdapter, "https://www.naukri.com/job-listings/frontend-engineer-123"], [FounditApplicationAdapter, "https://www.foundit.in/job/frontend-engineer-123"],
  [ShineApplicationAdapter, "https://www.shine.com/jobs/frontend-engineer/123"], [TimesJobsApplicationAdapter, "https://www.timesjobs.com/job-detail/frontend-engineer-123"],
  [HiristApplicationAdapter, "https://www.hirist.tech/j/frontend-engineer/123"], [InstahyreApplicationAdapter, "https://www.instahyre.com/job-123"],
  [CutshortApplicationAdapter, "https://cutshort.io/job/frontend-engineer/123"], [IimJobsApplicationAdapter, "https://www.iimjobs.com/j/frontend-engineer/123"],
  [ApnaApplicationAdapter, "https://apna.co/job/frontend-engineer-123"], [FreshersworldApplicationAdapter, "https://www.freshersworld.com/jobs/frontend-engineer-jobs"],
  [InternshalaApplicationAdapter, "https://internshala.com/job/detail/frontend-engineer-123"], [WorkIndiaApplicationAdapter, "https://www.workindia.in/job/frontend-engineer-123"],
  [HerKeyApplicationAdapter, "https://www.herkey.com/job/frontend-engineer-123"], [HirectApplicationAdapter, "https://hirect.in/jobs/frontend-engineer-123"],
  [CanadaJobBankApplicationAdapter, "https://www.jobbank.gc.ca/jobsearch/jobposting/123"], [ElutaApplicationAdapter, "https://www.eluta.ca/spl/frontend-engineer-123"],
  [WorkopolisApplicationAdapter, "https://www.workopolis.com/jobsearch/job/frontend-engineer-123"], [JobillicoApplicationAdapter, "https://www.jobillico.com/job/frontend-engineer/123"],
  [WowJobsApplicationAdapter, "https://www.wowjobs.ca/jobs/frontend+engineer"], [JobsGcApplicationAdapter, "https://jobs.gc.ca/job/123"],
  [JobStreetApplicationAdapter, "https://sg.jobstreet.com/job/frontend-engineer-123"], [JobsDbApplicationAdapter, "https://sg.jobsdb.com/job/frontend-engineer-123"],
  [MyCareersFutureApplicationAdapter, "https://www.mycareersfuture.gov.sg/job/frontend-engineer-123"], [GlintsApplicationAdapter, "https://glints.com/sg/en/opportunities/jobs/frontend-engineer/123"],
  [FastJobsApplicationAdapter, "https://www.fastjobs.sg/job/frontend-engineer-123"], [WantedlyApplicationAdapter, "https://www.wantedly.com/projects/123"],
  [GreenJapanApplicationAdapter, "https://www.green-japan.com/job/123"], [DaijobApplicationAdapter, "https://www.daijob.com/jobs/detail/123"],
  [CareerCrossApplicationAdapter, "https://www.careercross.com/job/detail/123"], [BizReachApplicationAdapter, "https://www.bizreach.jp/job/view/123"],
  [MynaviApplicationAdapter, "https://www.mynavi.jp/job/123"], [RikunabiApplicationAdapter, "https://job.rikunabi.com/2027/company/r123"],
  [EnJapanApplicationAdapter, "https://employment.en-japan.com/desc_123/"], [GaijinPotApplicationAdapter, "https://jobs.gaijinpot.com/job/view/job_id/123"],
  [IndeedApplicationAdapter, "https://www.indeed.com/viewjob?jk=123"], [LinkedInApplicationAdapter, "https://www.linkedin.com/jobs/view/123"],
  [WellfoundApplicationAdapter, "https://wellfound.com/jobs/123"], [RemoteOkApplicationAdapter, "https://remoteok.com/remote-jobs/123"],
  [WeWorkRemotelyApplicationAdapter, "https://weworkremotely.com/remote-jobs/acme-frontend-engineer"], [RemotiveApplicationAdapter, "https://remotive.com/remote-jobs/software-dev/frontend-engineer-123"],
  [HimalayasApplicationAdapter, "https://himalayas.app/jobs/frontend-engineer-123"], [WorkingNomadsApplicationAdapter, "https://www.workingnomads.com/jobs/frontend-engineer-123"],
  [DiceApplicationAdapter, "https://www.dice.com/jobs/detail/frontend-engineer-123"], [FlexJobsApplicationAdapter, "https://www.flexjobs.com/remote-jobs/job/frontend-engineer-123"],
  [BuiltInApplicationAdapter, "https://builtin.com/job/frontend-engineer/123"], [YCombinatorApplicationAdapter, "https://www.workatastartup.com/jobs/123"],
  [WelcomeToTheJungleApplicationAdapter, "https://www.welcometothejungle.com/en/companies/acme/jobs/frontend-engineer_123"],
  [HackerNewsApplicationAdapter, "https://news.ycombinator.com/item?id=123"]
] as const;

describe("job platform application adapters", () => {
  test.each(cases)("recognizes %p", (Adapter, url) => expect(new Adapter().canHandle(url)).toBe(true));

  test("factory includes the expanded platform registry without duplicates", () => {
    const adapters = createHostedAtsApplicationAdapters();
    const names = adapters.map((adapter) => adapter.name);
    expect(names.length).toBeGreaterThanOrEqual(80);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["naukri", "canada-job-bank", "jobstreet", "wantedly", "indeed", "greenhouse", "workday", "remote-ok"]));
  });

  test("does not claim unrelated sites", () => {
    for (const [Adapter] of cases) {
      const adapter = new Adapter();
      expect(adapter.canHandle("https://example.com/jobs/123")).toBe(false);
      expect(adapter.canHandle("not-a-url")).toBe(false);
    }
  });

  test("does not match bare ATS vendor domains when a hosted job domain is required", () => {
    expect(new GreenhouseApplicationAdapter().canHandle("https://greenhouse.io/jobs/123")).toBe(false);
    expect(new LeverApplicationAdapter().canHandle("https://lever.com/jobs/123")).toBe(false);
    expect(new WorkdayApplicationAdapter().canHandle("https://workday.com/jobs/123")).toBe(false);
  });
});
