import { Database } from "../database/Database";

interface LearningRow {
  title: string;
  country: string | null;
  workplace_type: string | null;
  platform: string | null;
  status: string;
  positive: boolean;
}

interface SourceStat { sampleSize: number; positive: number; successRate: number; }
interface KeywordStat { sampleSize: number; positive: number; successRate: number; }

export interface AdaptiveLearningPolicy {
  sampleSize: number;
  outcomeCount: number;
  sourceStats: Record<string, SourceStat>;
  keywordStats: Record<string, KeywordStat>;
  countryStats: Record<string, SourceStat>;
  workplaceStats: Record<string, SourceStat>;
}

const EMPTY_POLICY: AdaptiveLearningPolicy = {
  sampleSize: 0,
  outcomeCount: 0,
  sourceStats: {},
  keywordStats: {},
  countryStats: {},
  workplaceStats: {}
};

export class AdaptiveLearningService {
  private policy: AdaptiveLearningPolicy = EMPTY_POLICY;
  private loadedAt = 0;
  private readonly ttlMs: number;

  constructor(
    private readonly database: Database,
    ttlMs = 30 * 60 * 1000
  ) {
    this.ttlMs = ttlMs;
  }

  async getGuidance(): Promise<string> {
    if (Date.now() - this.loadedAt > this.ttlMs) await this.refresh();
    return formatGuidance(this.policy);
  }

  async refresh(): Promise<AdaptiveLearningPolicy> {
    const result = await this.database.query<LearningRow>(`
      SELECT
        jo.title,
        jo.country,
        jo.workplace_type,
        latest.platform,
        a.status,
        (a.status = 'RESPONDED' OR EXISTS (
          SELECT 1 FROM interviews i WHERE i.application_id = a.id
        )) AS positive
      FROM applications a
      JOIN job_opportunities jo ON jo.id = COALESCE(a.job_opportunity_id, (
        SELECT j.job_opportunity_id FROM jobs j WHERE j.id = a.job_id
      ))
      LEFT JOIN LATERAL (
        SELECT jo2.platform
        FROM job_observations jo2
        WHERE jo2.job_opportunity_id = jo.id
        ORDER BY jo2.observed_at DESC
        LIMIT 1
      ) latest ON true
      WHERE a.status IN ('RESPONDED', 'REJECTED')
         OR EXISTS (SELECT 1 FROM interviews i WHERE i.application_id = a.id)
      ORDER BY a.updated_at DESC
      LIMIT 5000
    `);

    const policy = buildPolicy(result.rows);
    this.policy = policy;
    this.loadedAt = Date.now();

    await this.database.query(
      `INSERT INTO ai_learning_policy (id, version, sample_size, policy, generated_at, updated_at)
       VALUES ('job-matching', 1, $1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         version = ai_learning_policy.version + 1,
         sample_size = EXCLUDED.sample_size,
         policy = EXCLUDED.policy,
         generated_at = EXCLUDED.generated_at,
         updated_at = NOW()`,
      [policy.outcomeCount, JSON.stringify(policy)]
    );

    return policy;
  }
}

function buildPolicy(rows: LearningRow[]): AdaptiveLearningPolicy {
  const sourceStats: Record<string, SourceStat> = {};
  const keywordStats: Record<string, KeywordStat> = {};
  const countryStats: Record<string, SourceStat> = {};
  const workplaceStats: Record<string, SourceStat> = {};

  for (const row of rows) {
    const positive = Boolean(row.positive);
    add(sourceStats, normalize(row.platform) || "unknown", positive);
    add(countryStats, normalize(row.country) || "unknown", positive);
    add(workplaceStats, normalize(row.workplace_type) || "unknown", positive);

    for (const keyword of extractKeywords(row.title)) {
      add(keywordStats, keyword, positive);
    }
  }

  return {
    sampleSize: rows.length,
    outcomeCount: rows.length,
    sourceStats: finalize(sourceStats),
    keywordStats: finalize(keywordStats),
    countryStats: finalize(countryStats),
    workplaceStats: finalize(workplaceStats)
  };
}

function add(target: Record<string, SourceStat>, key: string, positive: boolean): void {
  const current = target[key] ?? { sampleSize: 0, positive: 0, successRate: 0 };
  current.sampleSize += 1;
  if (positive) current.positive += 1;
  target[key] = current;
}

function finalize<T extends SourceStat>(stats: Record<string, T>): Record<string, T> {
  for (const stat of Object.values(stats)) stat.successRate = Number((stat.positive / stat.sampleSize).toFixed(3));
  return stats;
}

function normalize(value: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function extractKeywords(title: string): string[] {
  const stop = new Set(["senior", "junior", "software", "developer", "engineer", "frontend", "front", "end", "full", "stack", "lead", "remote"]);
  return [...new Set(
    title.toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 4 && !stop.has(x))
  )].slice(0, 12);
}

function formatGuidance(policy: AdaptiveLearningPolicy): string {
  if (policy.outcomeCount < 10) {
    return "Historical outcome data is currently limited; do not change the decision based on learning signals alone.";
  }

  const top = (stats: Record<string, SourceStat | KeywordStat>) => Object.entries(stats)
    .filter(([, stat]) => stat.sampleSize >= 5)
    .sort((a, b) => b[1].successRate - a[1].successRate)
    .slice(0, 8)
    .map(([key, stat]) => `${key}: ${Math.round(stat.successRate * 100)}% positive (${stat.sampleSize} outcomes)`)
    .join("; ");

  return [
    `Historical outcomes: ${policy.outcomeCount}. These are weak signals, not hard rules.`,
    top(policy.sourceStats) ? `Higher-response sources: ${top(policy.sourceStats)}` : "",
    top(policy.keywordStats) ? `Higher-response title terms: ${top(policy.keywordStats)}` : "",
    top(policy.countryStats) ? `Higher-response countries: ${top(policy.countryStats)}` : "",
    top(policy.workplaceStats) ? `Higher-response workplace types: ${top(policy.workplaceStats)}` : "",
    "Do not invent skills, experience, eligibility, salary, location permission, or recruiter information from historical signals."
  ].filter(Boolean).join("\n");
}
