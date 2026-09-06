import { Page } from "playwright";
import {
  ApplicationAdapter,
  ApplicationContext,
  ApplicationSubmissionResult
} from "./ApplicationAdapter";
import { GenericApplicationAdapter } from "./GenericApplicationAdapter";

abstract class HostedAtsApplicationAdapter implements ApplicationAdapter {
  abstract readonly name: string;
  protected abstract readonly hostPatterns: readonly RegExp[];

  constructor(protected readonly formAdapter = new GenericApplicationAdapter()) {}

  canHandle(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return this.hostPatterns.some((pattern) => pattern.test(hostname));
    } catch {
      return false;
    }
  }

  async submit(page: Page, context: ApplicationContext): Promise<ApplicationSubmissionResult> {
    return this.formAdapter.submit(page, context);
  }
}

export class GreenhouseApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "greenhouse";
  protected readonly hostPatterns = [/^(?:job-boards|boards)\.greenhouse\.io$/i, /\.greenhouse\.io$/i];
}
export class LeverApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "lever";
  protected readonly hostPatterns = [/^jobs\.lever\.co$/i, /\.lever\.co$/i];
}
export class AshbyApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "ashby";
  protected readonly hostPatterns = [/^jobs\.ashbyhq\.com$/i, /\.ashbyhq\.com$/i];
}
export class WorkableApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "workable";
  protected readonly hostPatterns = [/^apply\.workable\.com$/i, /\.workable\.com$/i];
}
export class SmartRecruitersApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "smartrecruiters";
  protected readonly hostPatterns = [/^jobs\.smartrecruiters\.com$/i, /\.smartrecruiters\.com$/i];
}
export class BambooHrApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "bamboohr";
  protected readonly hostPatterns = [/\.bamboohr\.com$/i];
}
export class TeamtailorApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "teamtailor";
  protected readonly hostPatterns = [/\.teamtailor\.com$/i];
}
export class RecruiteeApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "recruitee";
  protected readonly hostPatterns = [/\.recruitee\.com$/i];
}
export class JobviteApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "jobvite";
  protected readonly hostPatterns = [/^jobs\.jobvite\.com$/i, /\.jobvite\.com$/i];
}
export class IcimsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "icims";
  protected readonly hostPatterns = [/\.icims\.com$/i];
}
export class PinpointApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "pinpoint";
  protected readonly hostPatterns = [/\.pinpointhq\.com$/i, /\.pinpoint\.com$/i];
}
export class JazzHrApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "jazzhr";
  protected readonly hostPatterns = [/\.jazz\.co$/i, /\.jazzhr\.com$/i];
}
export class WorkdayApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "workday";
  protected readonly hostPatterns = [/\.myworkdayjobs\.com$/i, /\.myworkdaysite\.com$/i];
}
export class TaleoApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "taleo";
  protected readonly hostPatterns = [/\.taleo\.net$/i, /\.taleo\.com$/i];
}
export class SuccessFactorsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "successfactors";
  protected readonly hostPatterns = [/\.successfactors\.com$/i, /\.successfactors\.eu$/i];
}
export class UkGApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "ukg";
  protected readonly hostPatterns = [/\.ultipro\.com$/i, /\.ukg\.com$/i];
}
export class OracleCloudApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "oracle-cloud";
  protected readonly hostPatterns = [/\.oraclecloud\.com$/i];
}

// India-focused job platforms. These are intentionally separate from ATS hosts because
// most require an authenticated candidate session and may redirect to an employer ATS.
export class NaukriApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "naukri";
  protected readonly hostPatterns = [/^(?:www\.)?naukri\.com$/i, /\.naukri\.com$/i];
}
export class FounditApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "foundit";
  protected readonly hostPatterns = [/^(?:www\.)?foundit\.in$/i, /\.foundit\.in$/i];
}
export class ShineApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "shine";
  protected readonly hostPatterns = [/^(?:www\.)?shine\.com$/i, /\.shine\.com$/i];
}
export class TimesJobsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "timesjobs";
  protected readonly hostPatterns = [/^(?:www\.)?timesjobs\.com$/i, /\.timesjobs\.com$/i];
}
export class HiristApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "hirist";
  protected readonly hostPatterns = [/^(?:www\.)?hirist\.tech$/i, /\.hirist\.tech$/i, /^(?:www\.)?hirist\.com$/i];
}
export class InstahyreApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "instahyre";
  protected readonly hostPatterns = [/^(?:www\.)?instahyre\.com$/i, /\.instahyre\.com$/i];
}
export class CutshortApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "cutshort";
  protected readonly hostPatterns = [/^(?:www\.)?cutshort\.io$/i, /\.cutshort\.io$/i];
}
export class IimJobsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "iimjobs";
  protected readonly hostPatterns = [/^(?:www\.)?iimjobs\.com$/i, /\.iimjobs\.com$/i];
}
export class ApnaApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "apna";
  protected readonly hostPatterns = [/^(?:www\.)?apna\.co$/i, /\.apna\.co$/i];
}
export class FreshersworldApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "freshersworld";
  protected readonly hostPatterns = [/^(?:www\.)?freshersworld\.com$/i, /\.freshersworld\.com$/i];
}
export class InternshalaApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "internshala";
  protected readonly hostPatterns = [/^(?:www\.)?internshala\.com$/i, /\.internshala\.com$/i];
}
export class WorkIndiaApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "workindia";
  protected readonly hostPatterns = [/^(?:www\.)?workindia\.in$/i, /\.workindia\.in$/i];
}
export class HerKeyApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "herkey";
  protected readonly hostPatterns = [/^(?:www\.)?herkey\.com$/i, /\.herkey\.com$/i];
}
export class HirectApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "hirect";
  protected readonly hostPatterns = [/^(?:www\.)?hirect\.in$/i, /\.hirect\.in$/i];
}

// Canada-focused job platforms.
export class CanadaJobBankApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "canada-job-bank";
  protected readonly hostPatterns = [/^(?:www\.)?jobbank\.gc\.ca$/i, /\.jobbank\.gc\.ca$/i];
}
export class ElutaApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "eluta";
  protected readonly hostPatterns = [/^(?:www\.)?eluta\.ca$/i, /\.eluta\.ca$/i];
}
export class WorkopolisApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "workopolis";
  protected readonly hostPatterns = [/^(?:www\.)?workopolis\.com$/i, /\.workopolis\.com$/i];
}
export class JobillicoApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "jobillico";
  protected readonly hostPatterns = [/^(?:www\.)?jobillico\.com$/i, /\.jobillico\.com$/i];
}
export class WowJobsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "wowjobs";
  protected readonly hostPatterns = [/^(?:www\.)?wowjobs\.ca$/i, /\.wowjobs\.ca$/i];
}
export class JobsGcApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "jobs-gc";
  protected readonly hostPatterns = [/^(?:www\.)?canada\.ca$/i, /^(?:www\.)?jobs\.gc\.ca$/i];
}

// Singapore / Southeast Asia.
export class JobStreetApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "jobstreet";
  protected readonly hostPatterns = [/^(?:www\.)?jobstreet\.com$/i, /\.jobstreet\.com$/i, /\.jobstreet\.com\.sg$/i];
}
export class JobsDbApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "jobsdb";
  protected readonly hostPatterns = [/^(?:www\.)?jobsdb\.com$/i, /\.jobsdb\.com$/i];
}
export class MyCareersFutureApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "mycareersfuture";
  protected readonly hostPatterns = [/^(?:www\.)?mycareersfuture\.gov\.sg$/i, /\.mycareersfuture\.gov\.sg$/i];
}
export class GlintsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "glints";
  protected readonly hostPatterns = [/^(?:www\.)?glints\.com$/i, /\.glints\.com$/i];
}
export class FastJobsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "fastjobs";
  protected readonly hostPatterns = [/^(?:www\.)?fastjobs\.sg$/i, /\.fastjobs\.sg$/i, /\.fastjobs\.my$/i];
}

// Japan-focused job platforms.
export class WantedlyApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "wantedly";
  protected readonly hostPatterns = [/^(?:www\.)?wantedly\.com$/i, /\.wantedly\.com$/i];
}
export class GreenJapanApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "green-japan";
  protected readonly hostPatterns = [/^(?:www\.)?green-japan\.com$/i, /\.green-japan\.com$/i];
}
export class DaijobApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "daijob";
  protected readonly hostPatterns = [/^(?:www\.)?daijob\.com$/i, /\.daijob\.com$/i];
}
export class CareerCrossApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "careercross";
  protected readonly hostPatterns = [/^(?:www\.)?careercross\.com$/i, /\.careercross\.com$/i];
}
export class BizReachApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "bizreach";
  protected readonly hostPatterns = [/^(?:www\.)?bizreach\.jp$/i, /\.bizreach\.jp$/i];
}
export class MynaviApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "mynavi";
  protected readonly hostPatterns = [/^(?:www\.)?mynavi\.jp$/i, /\.mynavi\.jp$/i];
}
export class RikunabiApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "rikunabi";
  protected readonly hostPatterns = [/^(?:www\.)?rikunabi\.com$/i, /\.rikunabi\.com$/i];
}
export class EnJapanApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "en-japan";
  protected readonly hostPatterns = [/^(?:www\.)?en-japan\.com$/i, /\.en-japan\.com$/i];
}
export class GaijinPotApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "gaijinpot";
  protected readonly hostPatterns = [/^(?:www\.)?gaijinpot\.com$/i, /\.gaijinpot\.com$/i];
}

// Global / remote / tech platforms.
export class IndeedApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "indeed";
  protected readonly hostPatterns = [/^(?:www\.)?indeed\.com$/i, /\.indeed\.com$/i, /\.indeed\.co\.in$/i, /\.indeed\.ca$/i, /\.indeed\.jp$/i];
}
export class LinkedInApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "linkedin";
  protected readonly hostPatterns = [/^(?:www\.)?linkedin\.com$/i, /\.linkedin\.com$/i];
}
export class WellfoundApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "wellfound";
  protected readonly hostPatterns = [/^(?:www\.)?wellfound\.com$/i, /\.wellfound\.com$/i];
}
export class RemoteOkApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "remote-ok";
  protected readonly hostPatterns = [/^(?:www\.)?remoteok\.com$/i, /\.remoteok\.com$/i];
}
export class WeWorkRemotelyApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "we-work-remotely";
  protected readonly hostPatterns = [/^(?:www\.)?weworkremotely\.com$/i, /\.weworkremotely\.com$/i];
}
export class RemotiveApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "remotive";
  protected readonly hostPatterns = [/^(?:www\.)?remotive\.com$/i, /\.remotive\.com$/i];
}
export class HimalayasApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "himalayas";
  protected readonly hostPatterns = [/^(?:www\.)?himalayas\.app$/i, /\.himalayas\.app$/i];
}
export class WorkingNomadsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "working-nomads";
  protected readonly hostPatterns = [/^(?:www\.)?workingnomads\.com$/i, /\.workingnomads\.com$/i];
}
export class DiceApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "dice";
  protected readonly hostPatterns = [/^(?:www\.)?dice\.com$/i, /\.dice\.com$/i];
}
export class FlexJobsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "flexjobs";
  protected readonly hostPatterns = [/^(?:www\.)?flexjobs\.com$/i, /\.flexjobs\.com$/i];
}
export class BuiltInApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "builtin";
  protected readonly hostPatterns = [/^(?:www\.)?builtin\.com$/i, /\.builtin\.com$/i];
}
export class YCombinatorApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "yc-work-at-a-startup";
  protected readonly hostPatterns = [/^(?:www\.)?workatastartup\.com$/i, /\.workatastartup\.com$/i];
}
export class WelcomeToTheJungleApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "welcome-to-the-jungle";
  protected readonly hostPatterns = [/^(?:www\.)?welcometothejungle\.com$/i, /\.welcometothejungle\.com$/i];
}
export class HackerNewsApplicationAdapter extends HostedAtsApplicationAdapter {
  readonly name = "hacker-news";
  protected readonly hostPatterns = [/^(?:news|hn)\.ycombinator\.com$/i];
}

export function createHostedAtsApplicationAdapters(): readonly ApplicationAdapter[] {
  return [
    new GreenhouseApplicationAdapter(), new LeverApplicationAdapter(), new AshbyApplicationAdapter(),
    new WorkableApplicationAdapter(), new SmartRecruitersApplicationAdapter(), new BambooHrApplicationAdapter(),
    new TeamtailorApplicationAdapter(), new RecruiteeApplicationAdapter(), new JobviteApplicationAdapter(),
    new IcimsApplicationAdapter(), new PinpointApplicationAdapter(), new JazzHrApplicationAdapter(),
    new WorkdayApplicationAdapter(), new TaleoApplicationAdapter(), new SuccessFactorsApplicationAdapter(),
    new UkGApplicationAdapter(), new OracleCloudApplicationAdapter(),
    new NaukriApplicationAdapter(), new FounditApplicationAdapter(), new ShineApplicationAdapter(),
    new TimesJobsApplicationAdapter(), new HiristApplicationAdapter(), new InstahyreApplicationAdapter(),
    new CutshortApplicationAdapter(), new IimJobsApplicationAdapter(), new ApnaApplicationAdapter(),
    new FreshersworldApplicationAdapter(), new InternshalaApplicationAdapter(), new WorkIndiaApplicationAdapter(),
    new HerKeyApplicationAdapter(), new HirectApplicationAdapter(),
    new CanadaJobBankApplicationAdapter(), new ElutaApplicationAdapter(), new WorkopolisApplicationAdapter(),
    new JobillicoApplicationAdapter(), new WowJobsApplicationAdapter(), new JobsGcApplicationAdapter(),
    new JobStreetApplicationAdapter(), new JobsDbApplicationAdapter(), new MyCareersFutureApplicationAdapter(),
    new GlintsApplicationAdapter(), new FastJobsApplicationAdapter(),
    new WantedlyApplicationAdapter(), new GreenJapanApplicationAdapter(), new DaijobApplicationAdapter(),
    new CareerCrossApplicationAdapter(), new BizReachApplicationAdapter(), new MynaviApplicationAdapter(),
    new RikunabiApplicationAdapter(), new EnJapanApplicationAdapter(), new GaijinPotApplicationAdapter(),
    new IndeedApplicationAdapter(), new LinkedInApplicationAdapter(), new WellfoundApplicationAdapter(),
    new RemoteOkApplicationAdapter(), new WeWorkRemotelyApplicationAdapter(), new RemotiveApplicationAdapter(),
    new HimalayasApplicationAdapter(), new WorkingNomadsApplicationAdapter(), new DiceApplicationAdapter(),
    new FlexJobsApplicationAdapter(), new BuiltInApplicationAdapter(), new YCombinatorApplicationAdapter(),
    new WelcomeToTheJungleApplicationAdapter(), new HackerNewsApplicationAdapter()
  ];
}
