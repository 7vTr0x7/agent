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
  protected readonly hostPatterns = [
    /^(?:job-boards|boards)\.greenhouse\.io$/i,
    /\.greenhouse\.io$/i
  ];
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

export function createHostedAtsApplicationAdapters(): readonly ApplicationAdapter[] {
  return [
    new GreenhouseApplicationAdapter(),
    new LeverApplicationAdapter(),
    new AshbyApplicationAdapter(),
    new WorkableApplicationAdapter(),
    new SmartRecruitersApplicationAdapter(),
    new BambooHrApplicationAdapter(),
    new TeamtailorApplicationAdapter(),
    new RecruiteeApplicationAdapter(),
    new JobviteApplicationAdapter(),
    new IcimsApplicationAdapter(),
    new PinpointApplicationAdapter(),
    new JazzHrApplicationAdapter()
  ];
}
