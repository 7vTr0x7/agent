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
