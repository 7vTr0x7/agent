import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { Database } from "../src/database/Database";
import { PublicHiringPostDiscoveryProvider } from "../src/recruiters/PublicHiringPostDiscoveryProvider";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";

function readableText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatEvidence(value: unknown): string {
  if (typeof value === "string") return readableText(value).slice(0, 3500);
  if (!value || typeof value !== "object") return readableText(value).slice(0, 3500);
  const evidence = value as Record<string, unknown>;
  const lines = [
    evidence.type && `Evidence type: ${readableText(evidence.type)}`,
    evidence.source && `Source: ${readableText(evidence.source)}`,
    evidence.postUrl && `Source URL: ${readableText(evidence.postUrl)}`,
    evidence.contactType && `Contact type: ${readableText(evidence.contactType)}`,
    evidence.author && `Person: ${readableText(evidence.author)}`,
    evidence.authorRole && `Role: ${readableText(evidence.authorRole)}`,
    evidence.employer && `Employer: ${readableText(evidence.employer)}`,
    evidence.employerDomain && `Employer domain: ${readableText(evidence.employerDomain)}`,
    evidence.targetRoles && `Target roles: ${readableText(Array.isArray(evidence.targetRoles) ? evidence.targetRoles.join(", ") : evidence.targetRoles)}`,
    evidence.hiringEvidenceScore !== undefined && `Hiring evidence score: ${readableText(evidence.hiringEvidenceScore)}`,
    evidence.evidenceFreshness && `Evidence freshness: ${readableText(evidence.evidenceFreshness)}`,
    evidence.evidence && `Evidence excerpt: ${readableText(Array.isArray(evidence.evidence) ? evidence.evidence.join(" ") : evidence.evidence)}`
  ].filter(Boolean) as string[];
  return lines.join("\n").slice(0, 3500);
}

async function normalizePersistedEvidence(database: Database): Promise<number> {
  const rows = await database.query<{ id: string; evidence: unknown }>(
    `SELECT id, relevance_evidence AS evidence
       FROM recruiter_contacts
      WHERE relevance_evidence IS NOT NULL
        AND jsonb_typeof(relevance_evidence) = 'object'`
  );
  let normalized = 0;
  for (const row of rows.rows) {
    const readable = formatEvidence(row.evidence);
    if (!readable) continue;
    await database.query(
      `UPDATE recruiter_contacts
          SET relevance_evidence=$2::jsonb, updated_at=NOW()
        WHERE id=$1`,
      [row.id, JSON.stringify(readable)]
    );
    normalized += 1;
  }
  return normalized;
}

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
  let normalizedEvidence = 0;
  try {
    for (const candidate of result.candidates) {
      const id = await repository.persistCandidate(profile.id, candidate);
      if (id) persisted += 1;
      else rejectedAtPersistence += 1;
    }
    normalizedEvidence = await normalizePersistedEvidence(database);
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
    evidence: readableText(candidate.discoveryEvidence[0]?.slice(0, 1200) ?? "")
  }));

  console.log(JSON.stringify({
    status: "ok",
    feature: "CONTENT_FIRST",
    independent: true,
    sendEnabled: false,
    realResultCount: realResults.length,
    persisted,
    rejectedAtPersistence,
    normalizedEvidence,
    results: realResults,
    metrics: result.metrics
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", feature: "CONTENT_FIRST", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
