import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { Database } from "../src/database/Database";
import { PublicHiringPostDiscoveryProvider } from "../src/recruiters/PublicHiringPostDiscoveryProvider";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";

async function main(): Promise<void> {
  const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved.");

  const preferredLocations = (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,India,Remote")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const maxQueriesRaw = Number.parseInt(process.env.PUBLIC_HIRING_POST_MAX_QUERIES ?? "11", 10);
  const maxQueries = Number.isInteger(maxQueriesRaw) && maxQueriesRaw > 0 ? maxQueriesRaw : 11;

  const provider = new PublicHiringPostDiscoveryProvider();
  const result = await provider.discover({
    targetRoles: [...profile.targetTitles],
    skills: [...profile.skills],
    yearsExperience: profile.yearsExperience,
    location: profile.location,
    preferredLocations,
    maxQueries
  });

  const database = new Database(process.env.DATABASE_URL ?? "");
  const repository = new ProactiveRecruiterRepository(database);
  let persisted = 0;
  let rejectedAtPersistence = 0;
  try {
    for (const candidate of result.candidates) {
      const id = await repository.persistCandidate(profile.id, candidate);
      if (id) persisted += 1;
      else rejectedAtPersistence += 1;
    }
  } finally {
    await database.close();
  }

  const realResults = result.candidates.map((candidate) => ({
    source: candidate.discoverySource,
    title: candidate.targetRoles[0] ?? candidate.recruiterRole,
    url: candidate.discoveryUrl,
    employer: candidate.employer,
    relevance: candidate.roleMatchScore,
    hiringEvidenceScore: candidate.hiringEvidenceScore,
    email: candidate.email ?? null,
    emailStatus: candidate.emailStatus,
    outreachState: candidate.email ? "PREPARED_ELIGIBLE" : "NO_EMAIL_FOUND",
    evidence: candidate.discoveryEvidence[0]?.slice(0, 1200) ?? ""
  }));

  console.log(JSON.stringify({
    status: "ok",
    feature: "CONTENT_FIRST",
    independent: true,
    sendEnabled: false,
    realResultCount: realResults.length,
    persisted,
    rejectedAtPersistence,
    results: realResults,
    metrics: result.metrics
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", feature: "CONTENT_FIRST", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
