import type { ApplicationAdapter } from "./ApplicationAdapter";

export type ApplicationCapabilityState =
  | "ACTIVE"
  | "CONFIGURABLE"
  | "CATALOG_ONLY"
  | "UNSUPPORTED"
  | "BLOCKED"
  | "MANUAL_REVIEW";

export interface ApplicationAdapterCapabilities {
  application: ApplicationCapabilityState;
  authenticationRequired: boolean;
  formSupport: boolean;
  attachmentSupport: boolean;
  customQuestionSupport: "SAFE_ONLY" | "UNSUPPORTED";
  submissionVerification: "REQUIRED" | "UNSUPPORTED";
}

export const ACTIVE_HOSTED_APPLICATION_ADAPTERS = new Set([
  "greenhouse",
  "lever",
  "ashby"
]);

const CATALOG_ONLY_HOSTED_APPLICATION_ADAPTERS = new Set([
  "workable", "smartrecruiters", "bamboohr", "teamtailor", "recruitee", "jobvite", "icims", "pinpoint", "jazzhr", "workday", "taleo", "successfactors", "ukg", "oracle-cloud",
  "naukri", "foundit", "shine", "timesjobs", "hirist", "instahyre", "cutshort", "iimjobs", "apna", "freshersworld", "internshala", "workindia", "herkey", "hirect", "aasaanjobs", "9naukri", "workex",
  "canada-job-bank", "eluta", "workopolis", "jobillico", "wowjobs", "jobs-gc", "jobboom", "careerbeacon", "workbc", "bcjobs",
  "jobstreet", "jobsdb", "mycareersfuture", "glints", "fastjobs", "cultjobs", "efinancialcareers", "jobscentral",
  "wantedly", "green-japan", "daijob", "careercross", "bizreach", "mynavi", "rikunabi", "en-japan", "gaijinpot", "baitoru", "froma",
  "indeed", "linkedin", "wellfound", "remote-ok", "we-work-remotely", "remotive", "himalayas", "working-nomads", "dice", "flexjobs", "builtin", "workatastartup", "y-combinator", "welcome-to-the-jungle", "hackernews"
]);

export function hostedAdapterCapabilities(name: string): ApplicationAdapterCapabilities {
  const active = ACTIVE_HOSTED_APPLICATION_ADAPTERS.has(name);
  return {
    application: active ? "ACTIVE" : "CATALOG_ONLY",
    authenticationRequired: false,
    formSupport: active,
    attachmentSupport: active,
    customQuestionSupport: "SAFE_ONLY",
    submissionVerification: active ? "REQUIRED" : "UNSUPPORTED"
  };
}

export function effectiveApplicationCapabilities(adapter: ApplicationAdapter): ApplicationAdapterCapabilities | null {
  if (adapter.capabilities) return adapter.capabilities;
  if (adapter.name === "generic-form") {
    return {
      application: "UNSUPPORTED",
      authenticationRequired: false,
      formSupport: false,
      attachmentSupport: false,
      customQuestionSupport: "UNSUPPORTED",
      submissionVerification: "UNSUPPORTED"
    };
  }
  if (ACTIVE_HOSTED_APPLICATION_ADAPTERS.has(adapter.name) || CATALOG_ONLY_HOSTED_APPLICATION_ADAPTERS.has(adapter.name)) {
    return hostedAdapterCapabilities(adapter.name);
  }
  return null;
}
