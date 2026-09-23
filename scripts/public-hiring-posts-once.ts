import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { Database } from "../src/database/Database";
import { PublicHiringPostDiscoveryProvider } from "../src/recruiters/PublicHiringPostDiscoveryProvider";

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

  const db = new Database(process.env.DATABASE_URL ?? "");
  let persistedResults = 0;
  for (const resource of result.contentResults) {
    const write = await db.query(
      `INSERT INTO public_hiring_resources (source_url,source,title,employer,employer_domain,role,role_match_score,hiring_evidence_score,evidence_freshness,discovery_evidence,last_seen_at,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),'ACTIVE')
       ON CONFLICT (source_url) DO UPDATE SET source=EXCLUDED.source,title=EXCLUDED.title,employer=EXCLUDED.employer,employer_domain=EXCLUDED.employer_domain,role=EXCLUDED.role,role_match_score=GREATEST(public_hiring_resources.role_match_score,EXCLUDED.role_match_score),hiring_evidence_score=GREATEST(public_hiring_resources.hiring_evidence_score,EXCLUDED.hiring_evidence_score),evidence_freshness=EXCLUDED.evidence_freshness,discovery_evidence=EXCLUDED.discovery_evidence,last_seen_at=NOW(),status='ACTIVE'
       RETURNING id`,
      [resource.url, resource.source, resource.title, resource.employer ?? null, resource.employerDomain ?? null, resource.role, resource.roleMatchScore, resource.hiringEvidenceScore, resource.evidenceFreshness, JSON.stringify(resource.discoveryEvidence)]
    );
    if (write.rowCount) persistedResults++;
  }

  const realResults = result.contentResults.map((resource) => ({
    source: resource.source,
    title: resource.title,
    url: resource.url,
    employer: resource.employer ?? null,
    employerDomain: resource.employerDomain ?? null,
    role: resource.role,
    relevance: resource.roleMatchScore,
    hiringEvidenceScore: resource.hiringEvidenceScore,
    evidenceFreshness: resource.evidenceFreshness,
    evidence: resource.discoveryEvidence[0]?.slice(0, 1200) ?? ""
  }));

  console.log(JSON.stringify({
    status: "ok",
    feature: "CONTENT_FIRST",
    independent: true,
    sendEnabled: false,
    realResultCount: realResults.length,
    persistedResultCount: persistedResults,
    results: realResults,
    metrics: result.metrics
  }, null, 2));
  await db.close();
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", feature: "CONTENT_FIRST", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
