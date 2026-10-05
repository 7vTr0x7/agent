import { CandidateProfile } from "../candidates/CandidateProfile";
import { ClaimedTask } from "../queue/TaskQueue";
import { hasExplicitMailboxEvidence, isEligibleForRealRecruiterSend, isPlausibleMailboxAddress } from "./RecruiterMailboxVerification";
import { RecruiterVerificationEvidence } from "./RecruiterDiscovery";
import { RecruiterOutreachSendTaskDispatcher } from "./RecruiterOutreachSendTask";
import { ProactiveRecruiterDiscoveryService } from "./ProactiveRecruiterDiscoveryService";
import { rankProactiveRecruiters } from "./ProactiveRecruiterRanking";
import { ProactiveRecruiterRepository, isEmployerEmailDomainConsistent } from "./ProactiveRecruiterRepository";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import { ProactiveRecruiterDiscoveryPayload, ProactiveRecruiterOutreachPayload, PROACTIVE_RECRUITER_DISCOVERY_TASK, PROACTIVE_RECRUITER_OUTREACH_TASK } from "./ProactiveRecruiterTask";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { isBlockedEmployerDomain } from "./RecruiterCompanyDomainResolver";

export interface ProactiveRecruiterTaskHandlerOptions {
  enabled: boolean;
  sendEnabled: boolean;
  maxCandidatesPerRun: number;
  requireVerifiedEmail: boolean;
  verifyEmail?: (email: string) => Promise<{ status: "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID" | string; confidence: number; verificationEvidence?: RecruiterVerificationEvidence[] }>;
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
    const contactFirstPrepared = await this.handleContactFirst(payload);
    if (contactFirstPrepared > 0) {
      this.logger.info({ prepared: contactFirstPrepared, sendEnabled: this.options.sendEnabled }, "Contact-first proactive recruiter runtime completed");
      return;
    }

    const preferredLocations = payload.preferredLocations?.length ? [...payload.preferredLocations] : ["Bengaluru", "Bangalore", "India", "Remote"];
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
    const metrics = typeof (this.discovery as unknown as { getLastRunMetrics?: () => unknown }).getLastRunMetrics === "function"
      ? (this.discovery as unknown as { getLastRunMetrics: () => unknown }).getLastRunMetrics()
      : undefined;
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
      if (!candidate.email && candidate.employerDomain) {
        try {
          const enriched = await new PublicRecruiterSearchProvider().discover({
            companyName: candidate.employer,
            companyDomain: candidate.employerDomain,
            jobTitle: candidate.targetRoles[0] ?? "Frontend Engineer",
            jobDescription: candidate.discoveryEvidence.join(" "),
            candidateProfileId: payload.candidateProfileId
          });
          const sameIdentity = enriched.contacts.find(contact =>
            contact.email &&
            ((candidate.recruiterName && contact.fullName && contact.fullName.toLowerCase() === candidate.recruiterName.toLowerCase()) ||
             (candidate.recruiterRole && contact.title && contact.title.toLowerCase().includes(candidate.recruiterRole.toLowerCase().split(" ")[0] ?? "")))
          );
          if (sameIdentity?.email && isCompatibleRecruiterEnrichmentEmail(sameIdentity.email, candidate.employerDomain)) {
            candidate.email = sameIdentity.email;
            candidate.emailStatus = "UNVERIFIED";
            candidate.verificationEvidence = [];
          }
        } catch (error) {
          this.logger.error({ error: error instanceof Error ? error.message : String(error), employer: candidate.employer }, "Proactive recruiter public email enrichment failed");
        }
      }

      if (candidate.email) {
        try {
          const verification = await verifier(candidate.email);
          candidate.emailStatus = normalizeEmailStatus(verification.status, verification.verificationEvidence);
          candidate.verificationEvidence = verification.verificationEvidence ?? [];
        } catch (error) {
          this.logger.error({ error: error instanceof Error ? error.message : String(error) }, "Proactive recruiter email verification failed");
          candidate.emailStatus = "UNVERIFIED";
          candidate.verificationEvidence = [];
        }
      }
      const recruiterContactId = await this.repository.persistCandidate(payload.candidateProfileId, candidate);
      if (!recruiterContactId) {
        this.logger.info({
          recruiterName: candidate.recruiterName,
          employer: candidate.employer,
          employerDomain: candidate.employerDomain ?? null,
          email: candidate.email ?? null,
          emailStatus: candidate.emailStatus,
          discoveryUrl: candidate.discoveryUrl,
          evidenceType: candidate.evidenceType,
          evidenceFreshness: candidate.evidenceFreshness
        }, "Proactive recruiter candidate rejected by persistence boundary");
        continue;
      }
      persisted += 1;

      const mailboxEvidence = hasExplicitMailboxEvidence(candidate.verificationEvidence ?? []);
      const canonicalEligible = isEligibleForRealRecruiterSend({
        verified: mailboxEvidence,
        mailboxEvidence,
        verificationEvidence: candidate.verificationEvidence ?? [],
        emailStatus: mailboxEvidence ? "VERIFIED" : candidate.emailStatus,
        verificationStatus: mailboxEvidence ? "mailbox_verified" : candidate.emailStatus === "LIKELY" ? "domain_mx_verified" : "public-web-unverified",
        relevanceStatus: candidate.evidenceFreshness === "current" ? "CURRENT" : candidate.evidenceFreshness === "recent" ? "RECENT" : candidate.evidenceFreshness === "historical" ? "HISTORICAL" : "UNKNOWN",
        suppressed: false
      });
      if (!canonicalEligible) continue;
      if (!candidate.email || candidate.emailStatus === "INVALID") continue;
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
      if (this.options.sendEnabled) await this.sendDispatcher.enqueue({ messageId: campaign.messageId, companyDomain: candidate.employerDomain });
    }
    this.logger.info({ discovered: discovered.length, persisted, prepared, sendEnabled: this.options.sendEnabled, ...(metrics !== undefined ? { metrics } : {}) }, "Proactive recruiter discovery completed");
  }

  private async handleContactFirst(payload: ProactiveRecruiterDiscoveryPayload): Promise<number> {
    const contacts = await this.repository.listPublicContactFirstCandidates(Math.max(1, Math.min(payload.maxCandidates, this.options.maxCandidatesPerRun)));
    let prepared = 0;
    for (const contact of contacts) {
      const email = contact.email.trim().toLowerCase();
      const domain = contact.companyDomain.trim().toLowerCase() || email.split("@")[1] || "";
      if (!isPlausibleMailboxAddress(email) || !domain || isBlockedEmployerDomain(domain)) continue;
      if (PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.trim().toLowerCase() === contact.companyName.trim().toLowerCase())) continue;

      const candidateName = payload.candidateName?.trim() || "Candidate";
      const greeting = contact.fullName?.trim() ? `Hi ${contact.fullName.trim().split(/\\s+/)[0]},` : "Hi there,";
      const body = [
        greeting,
        "",
        `My name is ${candidateName}, and I’m a Full-Stack Developer with ${payload.yearsExperience} years of experience, with a strong focus on React, Next.js, TypeScript, JavaScript, and Node.js/Express.`,
        "",
        "I’m currently exploring Full-Stack Developer opportunities where I can contribute across frontend development and backend/API work.",
        "",
        "I wanted to introduce myself and share my resume in case my background is relevant to any current or upcoming opportunities.",
        "",
        "I’ve attached my resume for reference. I’d be happy to share any additional information about my experience.",
        "",
        "Thank you for your time,",
        "",
        candidateName
      ].join("\n");
}

function freshnessScore(value: string): number { return value === "current" ? 100 : value === "recent" ? 75 : value === "historical" ? 40 : 10; }
function emailScore(value: string): number { return value === "VERIFIED" ? 100 : value === "LIKELY" ? 60 : value === "UNVERIFIED" ? 20 : 0; }
function employerRelevance(employer: string, preferredLocations: string[], remoteEligible: boolean): number { if (employer === "Unknown employer") return 20; return preferredLocations.length || remoteEligible ? 60 : 50; }
function locationScore(evidence: string, preferredLocations: string[], remoteEligible: boolean): number { const haystack = evidence.toLowerCase(); if (preferredLocations.some((location) => haystack.includes(location.toLowerCase()))) return 100; return remoteEligible && /remote|india|bengaluru|bangalore/i.test(haystack) ? 80 : 30; }
