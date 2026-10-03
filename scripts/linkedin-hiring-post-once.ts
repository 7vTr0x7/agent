import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { TaskQueue } from "../src/queue/TaskQueue";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { RecruiterOutreachSendTaskDispatcher } from "../src/recruiters/RecruiterOutreachSendTask";
import { LinkedInHiringPostEmailDiscovery } from "../src/recruiters/LinkedInHiringPostEmailDiscovery";

function buildMessage(profile: { fullName?: string | null; firstName?: string | null; lastName?: string | null; yearsExperience: number; skills: readonly string[]; targetTitles: readonly string[]; location?: string | null }, candidate: { employer: string }): { subject: string; body: string } {
  const name = profile.fullName?.trim() || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Salman";
  const roles = profile.targetTitles.slice(0, 3).join(" / ") || "Frontend / React / Next.js";
  const skills = profile.skills.slice(0, 7).join(", ");
  const location = profile.location ? ` based in ${profile.location}` : "";
  return {
    subject: `Application — ${roles} — ${name}`,
    body: [
      "Hi,",
      "",
      `I’m ${name}, a ${profile.yearsExperience}-year experienced Frontend/React developer${location}.`,
      `I’m interested in the ${roles} opportunity you shared for ${candidate.employer}.`,
      `My experience includes ${skills}.`,
      "",
      "I’ve attached my resume for your consideration. I’d be happy to discuss the role and my experience.",
      "",
      "Thanks,",
      name
    ].join("\n")
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.proactiveRecruiter.enabled) throw new Error("PROACTIVE_RECRUITER_ENABLED must be true.");
  const database = new Database(config.databaseUrl);
  try {
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const preferredLocations = (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,Pune,India,Remote").split(",").map(v => v.trim()).filter(Boolean);
    const discovery = new LinkedInHiringPostEmailDiscovery();
    const result = await discovery.discover({
      targetRoles: [...profile.targetTitles],
      skills: [...profile.skills],
      yearsExperience: profile.yearsExperience,
      preferredLocations,
      maxQueries: Number(process.env.PUBLIC_HIRING_POST_MAX_QUERIES ?? "4")
    });

    const repository = new ProactiveRecruiterRepository(database);
    const queue = new TaskQueue(database);
    const dispatcher = new RecruiterOutreachSendTaskDispatcher(queue);

    const live = config.proactiveRecruiter.sendEnabled
      && config.recruiterOutreach.enabled
      && config.recruiterOutreach.activation === "live"
      && config.recruiterOutreach.liveActivationConfirmed
      && !config.recruiterOutreach.dryRun
      && config.outboundEnabled
      && config.gmail.enabled;

    const persisted: Array<Record<string, unknown>> = [];
    const prepared: Array<Record<string, unknown>> = [];
    const queued: Array<Record<string, unknown>> = [];

    for (const candidate of result.candidates.slice(0, config.proactiveRecruiter.maxCandidatesPerRun)) {
      const id = await repository.persistCandidate(profile.id, candidate);
      if (!id) continue;
      persisted.push({
        recruiterContactId: id,
        employer: candidate.employer,
        email: candidate.email,
        discoveryUrl: candidate.discoveryUrl,
        roleMatchScore: candidate.roleMatchScore
      });

      const message = buildMessage(profile, candidate);
      const campaign = await repository.createProactiveCampaign({
        recruiterContactId: id,
        candidateProfileId: profile.id,
        targetRoles: [...profile.targetTitles],
        subject: message.subject,
        body: message.body
      });
      if (!campaign) continue;
      prepared.push({
        recruiterContactId: id,
        messageId: campaign.messageId,
        employer: candidate.employer,
        email: candidate.email,
        subject: message.subject,
        discoveryUrl: candidate.discoveryUrl
      });
      if (live && candidate.employerDomain) {
        await dispatcher.enqueue({ messageId: campaign.messageId, companyDomain: candidate.employerDomain });
        queued.push({
          messageId: campaign.messageId,
          employer: candidate.employer,
          email: candidate.email
        });
      }
    }

    console.log(JSON.stringify({
      status: "ok",
      operationalStatus: "SUCCESS",
      feature: "LINKEDIN_HIRING_POST_EMAIL_FIRST",
      live,
      sendEnabled: config.proactiveRecruiter.sendEnabled,
      activation: config.recruiterOutreach.activation,
      gmailEnabled: config.gmail.enabled,
      outboundEnabled: config.outboundEnabled,
      metrics: result.metrics,
      persisted,
      prepared,
      queued,
      nextStep: live ? "SEND_TASKS_QUEUED" : "SET_RECRUITER_OUTREACH_ACTIVATION=live_AND_RECRUITER_LIVE_ACTIVATION_CONFIRMED=true_FOR_SEND"
    }, null, 2));
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      status: "FAILED",
      feature: "LINKEDIN_HIRING_POST_EMAIL_FIRST",
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  });
}
