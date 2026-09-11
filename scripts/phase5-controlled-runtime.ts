import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { TaskWorker } from "../src/queue/TaskWorker";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";
import { DISCOVER_RECRUITERS_TASK } from "../src/recruiters/RecruiterDiscoveryTask";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { PersistentRecruiterDiscoveryService } from "../src/recruiters/PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryTaskHandler } from "../src/recruiters/RecruiterDiscoveryTaskHandler";
import { createRecruiterDiscoveryProvider } from "../src/recruiters/createRecruiterDiscoveryProvider";
import { PREPARE_RECRUITER_OUTREACH_TASK, RecruiterOutreachPreparationTaskDispatcher } from "../src/recruiters/RecruiterOutreachPreparationTask";
import { RecruiterOutreachPreparationService } from "../src/recruiters/RecruiterOutreachPreparationService";
import { RecruiterOutreachPreparationTaskHandler } from "../src/recruiters/RecruiterOutreachPreparationTaskHandler";
import { MATCH_JOB_TASK } from "../src/matching/MatchTask";

const logger = {
  info: (message: string) => console.log(JSON.stringify({ level: "info", msg: message })),
  warn: (message: string) => console.warn(JSON.stringify({ level: "warn", msg: message })),
  error: (bindings: Record<string, unknown>, message: string) => console.error(JSON.stringify({ level: "error", ...bindings, msg: message }))
};

async function drain(worker: TaskWorker, taskType: string, limit: number): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const didProcess = await worker.runOnce([taskType]);
    if (!didProcess) break;
    processed += 1;
  }
  return processed;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.automationEnabled || config.gmail.enabled || config.outboundEnabled) throw new Error("Phase 5 runtime requires automation, Gmail, and outbound sending to remain disabled.");
  if (!config.recruiterOutreach.enabled) throw new Error("Phase 5 runtime requires RECRUITER_OUTREACH_ENABLED=true for the controlled recruiter pipeline.");
  if (!config.recruiterOutreach.dryRun) throw new Error("Phase 5 runtime requires RECRUITER_OUTREACH_DRY_RUN=true.");
  if (!config.applicationDryRun) throw new Error("Phase 5 runtime requires APPLICATION_DRY_RUN=true.");

  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();
    const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

    const queue = new TaskQueue(database);
    const discoveryRuntime = createDiscoveryRuntime(database, queue, config, candidateProfile);
    logger.info(`Starting Phase 5 controlled discovery across ${discoveryRuntime.sourceCount} configured source(s).`);
    const discoveryResults = await discoveryRuntime.runner.runOnce();
    const discoveredJobs = discoveryResults.reduce((sum, result) => sum + result.discovered, 0);
    const insertedJobs = discoveryResults.reduce((sum, result) => sum + result.matching, 0);

    const matchingWorker = new TaskWorker(queue, new Map([[MATCH_JOB_TASK, discoveryRuntime.matchTaskHandler]]), { logger });
    const matchingProcessed = await drain(matchingWorker, MATCH_JOB_TASK, Number(process.env.PHASE5_MATCH_LIMIT ?? "50"));

    const recruiterRepository = new RecruiterDiscoveryRepository(database);
    const provider = createRecruiterDiscoveryProvider({ provider: config.recruiterOutreach.discoveryProvider });
    const discovery = new PersistentRecruiterDiscoveryService({
      provider,
      repository: recruiterRepository,
      minConfidence: config.recruiterOutreach.minConfidence,
      requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail
    });
    const preparationDispatcher = new RecruiterOutreachPreparationTaskDispatcher(queue);
    const recruiterHandler = new RecruiterDiscoveryTaskHandler(discovery, config.recruiterOutreach.maxContactsPerApplication, preparationDispatcher, logger);
    const preparationHandler = new RecruiterOutreachPreparationTaskHandler(
      new RecruiterOutreachPreparationService({
        repository: recruiterRepository,
        minConfidence: config.recruiterOutreach.minConfidence,
        requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail,
        dryRun: true
      }),
      undefined,
      logger
    );

    const recruiterWorker = new TaskWorker(queue, new Map([[DISCOVER_RECRUITERS_TASK, recruiterHandler]]), { logger });
    const recruiterProcessed = await drain(recruiterWorker, DISCOVER_RECRUITERS_TASK, Number(process.env.PHASE5_RECRUITER_LIMIT ?? "20"));

    const preparationWorker = new TaskWorker(queue, new Map([[PREPARE_RECRUITER_OUTREACH_TASK, preparationHandler]]), { logger });
    const preparationProcessed = await drain(preparationWorker, PREPARE_RECRUITER_OUTREACH_TASK, Number(process.env.PHASE5_PREPARATION_LIMIT ?? "20"));

    const counts = await database.query<{ jobs: string; matches: string; recruiter_runs: string; recruiters: string; email_candidates: string; prepared_messages: string; sent_messages: string; applications: string }>(
      `SELECT
        (SELECT COUNT(*) FROM job_opportunities)::text AS jobs,
        (SELECT COUNT(*) FROM match_decisions)::text AS matches,
        (SELECT COUNT(*) FROM recruiter_discovery_runs)::text AS recruiter_runs,
        (SELECT COUNT(*) FROM recruiter_contacts)::text AS recruiters,
        (SELECT COUNT(*) FROM recruiter_contacts WHERE email IS NOT NULL)::text AS email_candidates,
        (SELECT COUNT(*) FROM recruiter_outreach_messages WHERE status='PREPARED')::text AS prepared_messages,
        (SELECT COUNT(*) FROM recruiter_outreach_messages WHERE status='SENT')::text AS sent_messages,
        (SELECT COUNT(*) FROM applications)::text AS applications`
    );
    const taskCounts = await database.query<{ task_type: string; status: string; count: string }>(
      `SELECT task_type,status,COUNT(*)::text AS count FROM tasks GROUP BY task_type,status ORDER BY task_type,status`
    );

    console.log(JSON.stringify({
      phase: 5,
      discovery: { sources: discoveryRuntime.sourceCount, sourceRuns: discoveryResults.length, discoveredJobs, insertedJobs },
      processed: { matching: matchingProcessed, recruiterDiscovery: recruiterProcessed, preparation: preparationProcessed },
      database: counts.rows[0],
      tasks: taskCounts.rows,
      safety: { gmailEnabled: config.gmail.enabled, outboundEnabled: config.outboundEnabled, automationEnabled: config.automationEnabled, applicationDryRun: config.applicationDryRun, recruiterDryRun: config.recruiterOutreach.dryRun }
    }, null, 2));

    const row = counts.rows[0];
    if (!row || Number(row.sent_messages) !== 0 || Number(row.applications) !== 0) throw new Error("Phase 5 safety assertion failed: outbound messages or applications were created.");
    if (Number(row.jobs) < 1 || Number(row.matches) < 1 || Number(row.recruiter_runs) < 1 || Number(row.recruiters) < 1 || Number(row.email_candidates) < 1 || Number(row.prepared_messages) < 1) {
      throw new Error("Phase 5 acceptance was not demonstrated: expected a discovered job, match, recruiter, public email candidate, and prepared outreach draft.");
    }
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
