import { CandidateProfile } from "../candidates/CandidateProfile";
import { ClaimedTask } from "../queue/TaskQueue";
import { RecruiterOutreachSendTaskDispatcher } from "./RecruiterOutreachSendTask";
import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";
import { rankProactiveRecruiters } from "./ProactiveRecruiterRanking";
import { ProactiveRecruiterRepository } from "./ProactiveRecruiterRepository";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import { ProactiveRecruiterDiscoveryPayload, ProactiveRecruiterOutreachPayload, PROACTIVE_RECRUITER_DISCOVERY_TASK, PROACTIVE_RECRUITER_OUTREACH_TASK } from "./ProactiveRecruiterTask";

export interface ProactiveRecruiterTaskHandlerOptions {
  enabled: boolean;
  sendEnabled: boolean;
  maxCandidatesPerRun: number;
  requireVerifiedEmail: boolean;
  verifyEmail?: (email: string) => Promise<{ status: "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID"; confidence: number }>;
}

export class ProactiveRecruiterTaskHandler {
  constructor(
    private readonly discovery: ProactiveRecruiterDiscoveryService,
    private readonly repository: ProactiveRecruiterRepository,
    private readonly sendDispatcher: RecruiterOutreachSendTaskDispatcher,
    private readonly options: ProactiveRecruiterTaskHandlerOptions,
    private readonly logger: { info: (payload: unknown, message: string) => void; error: (payload: unknown, message: string) => void }
  ) {}

  async handle(task: ClaimedTask): Promise<void> {
    if (task.taskType === PROACTIVE_RECRUITER_DISCOVERY_TASK) {
      await this.handleDiscovery(assertDiscoveryPayload(task.payload));
      return;
    }
    if (task.taskType === PROACTIVE_RECRUITER_OUTREACH_TASK) {
      await this.handleOutreach(assertOutreachPayload(task.payload));
      return;
    }
    throw new Error(`Unsupported proactive recruiter task type: ${task.taskType}`);
  }

  async handleDiscovery(payload: ProactiveRecruiterDiscoveryPayload): Promise<void> {
    if (!this.options.enabled) return;
    const preferredLocations = payload.preferredLocations?.length
      ? [...payload.preferredLocations]
      : ["Bengaluru", "Bangalore", "India", "Remote"];
    const profile: CandidateProfile = {
      id: payload.candidateProfileId,
      yearsExperience: payload.yearsExperience,
      skills: [...payload.skills],
      targetTitles: [...payload.targetRoles],
      location: payload.location,
      fullName: payload.candidateName,
      standardizedAnswers: { preferredLocations: preferredLocations.join(", ") }
    };
    const discovered = await this.discovery.discover({
      targetRoles: [...profile.targetTitles],
      skills: [...profile.skills],
      yearsExperience: profile.yearsExperience,
      preferredLocations,
      remoteEligible: payload.remoteEligible
    });
    const ranked = rankProactiveRecruiters(discovered.map((candidate, index) => ({
      id: candidate.discoveryUrl || `${candidate.recruiterName}:${index}`,
      roleMatchScore: candidate.roleMatchScore,
      hiringEvidenceScore: candidate.hiringEvidenceScore,
      evidenceFreshnessScore: freshnessScore(candidate.evidenceFreshness),
      employerRelevanceScore: employerRelevance(candidate.employer, preferredLocations, payload.remoteEligible ?? false),
      emailConfidenceScore: emailScore(candidate.emailStatus),
      locationRelevanceScore: locationScore(candidate.discoveryEvidence.join(" "), preferredLocations, payload.remoteEligible ?? false),
      suppressed: false
    })));

    const byId = new Map(discovered.map((candidate) => [candidate.discoveryUrl, candidate]));
    const verifier = this.options.verifyEmail ?? ((email: string) => new PublicRecruiterSearchProvider().verify(email));
    let persisted = 0;
    let prepared = 0;
    for (const rankedCandidate of ranked.slice(0, Math.max(1, Math.min(payload.maxCandidates, this.options.maxCandidatesPerRun)))) {
      const candidate = byId.get(rankedCandidate.id);
      if (!candidate) continue;
      if (candidate.email) {
        try {
          const verification = await verifier(candidate.email);
          candidate.emailStatus = normalizeEmailStatus(verification.status);
        } catch (error) {
          this.logger.error({ error: error instanceof Error ? error.message : String(error) }, "Proactive recruiter email verification failed");
          candidate.emailStatus = "UNVERIFIED";
        }
      }
      const recruiterContactId = await this.repository.persistCandidate(payload.candidateProfileId, candidate);
      if (!recruiterContactId) continue;
      persisted += 1;

      if (!candidate.email || candidate.emailStatus === "INVALID") continue;
      if (this.options.requireVerifiedEmail && candidate.emailStatus !== "VERIFIED") continue;
      if (!candidate.employerDomain) continue;

      const subject = `Frontend / React / Next.js opportunities — ${profile.fullName ?? "Candidate"}`;
      const body = buildProactiveMessage(profile, candidate);
      const campaign = await this.repository.createProactiveCampaign({
        recruiterContactId,
        candidateProfileId: payload.candidateProfileId,
        targetRoles: [...profile.targetTitles],
        subject,
        body
      });
      if (!campaign) continue;
      prepared += 1;
      if (this.options.sendEnabled) {
        await this.sendDispatcher.enqueue({ messageId: campaign.messageId, companyDomain: candidate.employerDomain });
      }
    }
    this.logger.info({ discovered: discovered.length, persisted, prepared, sendEnabled: this.options.sendEnabled }, "Proactive recruiter discovery completed");
  }

  async handleOutreach(payload: ProactiveRecruiterOutreachPayload): Promise<void> {
    if (!this.options.sendEnabled) return;
    await this.sendDispatcher.enqueue({ messageId: payload.messageId, companyDomain: payload.companyDomain });
  }
}

function assertDiscoveryPayload(payload: Record<string, unknown>): ProactiveRecruiterDiscoveryPayload {
  if (
    typeof payload.candidateProfileId !== "string" ||
    typeof payload.yearsExperience !== "number" ||
    !Array.isArray(payload.skills) || !payload.skills.every((value): value is string => typeof value === "string") ||
    !Array.isArray(payload.targetRoles) || !payload.targetRoles.every((value): value is string => typeof value === "string") ||
    typeof payload.maxCandidates !== "number"
  ) {
    throw new Error("Invalid proactive recruiter discovery task payload");
  }
  if (payload.candidateName !== undefined && typeof payload.candidateName !== "string") throw new Error("Invalid proactive recruiter candidate name");
  if (payload.location !== undefined && typeof payload.location !== "string") throw new Error("Invalid proactive recruiter location");
  if (payload.preferredLocations !== undefined && (!Array.isArray(payload.preferredLocations) || !payload.preferredLocations.every((value): value is string => typeof value === "string"))) {
    throw new Error("Invalid proactive recruiter preferred locations");
  }
  if (payload.remoteEligible !== undefined && typeof payload.remoteEligible !== "boolean") throw new Error("Invalid proactive recruiter remote eligibility");
  return {
    candidateProfileId: payload.candidateProfileId,
    candidateName: payload.candidateName,
    yearsExperience: payload.yearsExperience,
    skills: payload.skills,
    targetRoles: payload.targetRoles,
    location: payload.location,
    preferredLocations: payload.preferredLocations,
    remoteEligible: payload.remoteEligible,
    maxCandidates: payload.maxCandidates
  };
}

function assertOutreachPayload(payload: Record<string, unknown>): ProactiveRecruiterOutreachPayload {
  if (typeof payload.messageId !== "string" || typeof payload.companyDomain !== "string" || typeof payload.candidateProfileId !== "string") {
    throw new Error("Invalid proactive recruiter outreach task payload");
  }
  return {
    messageId: payload.messageId,
    companyDomain: payload.companyDomain,
    candidateProfileId: payload.candidateProfileId
  };
}

function normalizeEmailStatus(value: string): "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID" {
  switch (value) {
    case "VERIFIED":
    case "LIKELY":
    case "UNVERIFIED":
    case "INVALID":
      return value;
    default:
      return "UNVERIFIED";
  }
}

function buildProactiveMessage(profile: CandidateProfile, candidate: { recruiterName: string; recruiterRole: string; employer: string; targetRoles: string[]; evidenceFreshness: string; discoveryEvidence: string[] }): string {
  const name = profile.fullName?.trim() || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Candidate";
  const roles = profile.targetTitles.length ? profile.targetTitles.slice(0, 3).join(" / ") : "Frontend / React / Next.js";
  const skills = profile.skills.slice(0, 5).join(", ");
  const location = profile.location ? ` I’m currently based in ${profile.location}.` : "";
  const evidenceLine = candidate.evidenceFreshness === "current"
    ? "Your public recruiting information appears relevant to these kinds of roles."
    : candidate.evidenceFreshness === "recent"
      ? "Your recent public recruiting information appears relevant to these kinds of roles."
      : "Your public recruiting background appears relevant to these kinds of roles.";
  return [
    `Hi ${candidate.recruiterName.split(" ")[0] || "there"},`,
    "",
    `I’m ${name}, and I’m exploring ${roles} opportunities.${location}`,
    `I have ${profile.yearsExperience} years of experience with ${skills}.`,
    evidenceLine,
    "",
    "I’m reaching out proactively rather than assuming there is a specific opening. If you recruit for roles that fit my background, I’d be happy to share my resume and discuss relevant opportunities.",
    "",
    "Thank you,",
    name
  ].join("\n");
}

function freshnessScore(value: string): number {
  return value === "current" ? 100 : value === "recent" ? 75 : value === "historical" ? 40 : 10;
}

function emailScore(value: string): number {
  return value === "VERIFIED" ? 100 : value === "LIKELY" ? 60 : value === "UNVERIFIED" ? 20 : 0;
}

function employerRelevance(employer: string, preferredLocations: string[], remoteEligible: boolean): number {
  if (employer === "Unknown employer") return 20;
  return preferredLocations.length || remoteEligible ? 60 : 50;
}

function locationScore(evidence: string, preferredLocations: string[], remoteEligible: boolean): number {
  const haystack = evidence.toLowerCase();
  if (preferredLocations.some((location) => haystack.includes(location.toLowerCase()))) return 100;
  return remoteEligible && /remote|india|bengaluru|bangalore/i.test(haystack) ? 80 : 30;
}
