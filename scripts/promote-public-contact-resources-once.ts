import { spawnSync } from "node:child_process";
import { Database } from "../src/database/Database";

export interface ContactPromotionInput {
  resourceId: string;
  email: string;
  companyName: string;
  sourceUrl: string;
  sourceType: string;
  validationStatus: "LIKELY" | "VERIFIED";
  relevanceScore: number;
  evidenceContext: string;
  observedAt: string;
}

const STRICT_EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const MALFORMED_EMAIL_SUFFIX = /(?:%[0-9a-f]{2}|\\|\.\.\.|[\"'()<>\[\],;:])/i;
const GENERIC_LOCAL_PART = /^(?:noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|helpdesk)$/i;

export function isSafePublicEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!STRICT_EMAIL.test(email)) return false;
  if (MALFORMED_EMAIL_SUFFIX.test(email.split("@")[1] ?? "")) return false;
  if (GENERIC_LOCAL_PART.test(email.split("@")[0] ?? "")) return false;
  return true;
}

export function buildContactPromotion(input: ContactPromotionInput): {
  companyName: string;
  email: string;
  sourceUrl: string;
  sourceType: string;
  validationStatus: string;
  relevanceScore: number;
  suppressed: boolean;
  provenance: Record<string, unknown>;
} {
  const email = input.email.trim().toLowerCase();
  if (!isSafePublicEmail(email)) throw new Error("INVALID_PUBLIC_EMAIL");
  return {
    companyName: input.companyName.trim().slice(0, 500),
    email,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    validationStatus: input.validationStatus,
    relevanceScore: input.relevanceScore,
    suppressed: false,
    provenance: {
      pipeline: "public_contact_resource",
      resourceId: input.resourceId,
      sourceUrl: input.sourceUrl,
      evidenceContext: input.evidenceContext.slice(0, 3500),
      observedAt: input.observedAt,
      publicEvidence: true,
      mailboxVerification: "NOT_CLAIMED"
    }
  };
}

function runScript(script: string): void {
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

async function main(): Promise<void> {
  runScript("scripts/public-contact-resources-once.ts");
  runScript("scripts/supplement-public-job-contact-resources-once.ts");
  runScript("scripts/public-contact-search-evidence-once.ts");

  const database = new Database(process.env.DATABASE_URL ?? "");
  try {
    const emailSql = "^[A-Za-z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$";
    await database.query(
      `UPDATE public_contact_resource_contacts
          SET validation_status='INVALID', relevance_score=0, updated_at=NOW()
        WHERE normalized_email IS NULL
           OR normalized_email !~ '${emailSql}'`
    );
    await database.query(
      `UPDATE contacts
          SET suppressed=TRUE, validation_status='INVALID', updated_at=NOW()
        WHERE COALESCE(suppressed,FALSE)=FALSE
          AND (email IS NULL OR email !~ '${emailSql}')`
    );

    const result = await database.query<{
      resource_id: string;
      email: string;
      title: string;
      source_url: string;
      source_type: string;
      validation_status: "LIKELY" | "VERIFIED" | "UNVERIFIED" | "INVALID";
      relevance_score: number;
      evidence_context: string;
      observed_at: string;
    }>(
      `SELECT DISTINCT ON (c.normalized_email)
          c.resource_id,
          c.normalized_email AS email,
          r.title,
          r.source_url,
          r.source_type,
          c.validation_status,
          c.relevance_score,
          c.evidence_context,
          c.observed_at
       FROM public_contact_resource_contacts c
       JOIN public_contact_resources r ON r.id = c.resource_id
       WHERE c.relevance_score >= 60
         AND c.validation_status IN ('LIKELY', 'VERIFIED')
         AND NULLIF(TRIM(c.normalized_email), '') IS NOT NULL
         AND c.normalized_email ~ '${emailSql}'
       ORDER BY c.normalized_email, c.relevance_score DESC, c.observed_at DESC`
    );

    let inserted = 0;
    let existing = 0;
    let suppressed = 0;
    for (const row of result.rows) {
      if (!isSafePublicEmail(row.email)) {
        suppressed += 1;
        continue;
      }
      let companyName: string;
      try {
        companyName = row.title.trim() || new URL(row.source_url).hostname;
      } catch {
        companyName = row.title.trim();
      }
      const promotion = buildContactPromotion({
        resourceId: row.resource_id,
        email: row.email,
        companyName,
        sourceUrl: row.source_url,
        sourceType: row.source_type,
        validationStatus: row.validation_status === "VERIFIED" ? "VERIFIED" : "LIKELY",
        relevanceScore: row.relevance_score,
        evidenceContext: row.evidence_context,
        observedAt: row.observed_at
      });

      const upsert = await database.query<{ inserted: boolean }>(
        `INSERT INTO contacts (
           company_name, email, source, source_url, source_type,
           provenance, validation_status, relevance_score, suppressed,
           created_at, updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,NOW(),NOW())
         ON CONFLICT (email) DO UPDATE SET
           company_name = CASE
             WHEN contacts.company_name IS NULL OR contacts.company_name = '' THEN EXCLUDED.company_name
             ELSE contacts.company_name
           END,
           source = EXCLUDED.source,
           source_url = EXCLUDED.source_url,
           source_type = EXCLUDED.source_type,
           provenance = EXCLUDED.provenance,
           validation_status = EXCLUDED.validation_status,
           relevance_score = GREATEST(contacts.relevance_score, EXCLUDED.relevance_score),
           suppressed = FALSE,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [promotion.companyName, promotion.email, "public_contact_resource", promotion.sourceUrl, promotion.sourceType, JSON.stringify(promotion.provenance), promotion.validationStatus, promotion.relevanceScore, promotion.suppressed]
      );
      if (upsert.rows[0]?.inserted) inserted += 1;
      else existing += 1;
    }

    const contactCount = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM contacts
        WHERE suppressed = FALSE
          AND validation_status IN ('LIKELY','VERIFIED')
          AND relevance_score >= 60
          AND source_url IS NOT NULL
          AND provenance->>'publicEvidence' = 'true'`
    );
    console.log(JSON.stringify({
      status: "ok",
      feature: "PUBLIC_CONTACT_RESOURCE",
      independent: true,
      resourcesBackedByPublicEvidence: result.rows.length,
      contactsPromoted: inserted,
      existingContacts: existing,
      malformedSuppressed: suppressed,
      contactsPersisted: Number(contactCount.rows[0]?.count ?? 0),
      applicationsSent: 0,
      outreachSent: 0,
      source: "public_contact_resource_contacts",
      mailboxVerificationClaimed: false
    }, null, 2));
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "FAILED",
      feature: "PUBLIC_CONTACT_RESOURCE",
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  });
}
