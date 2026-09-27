import { Database } from "../src/database/Database";

const SAFE_EMAIL_SQL = "^[A-Za-z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$";
const ENCODED_FRAGMENT = /(?:%[0-9a-f]{2}|\\|\.\.\.|[\"'()<>\[\],;:])/i;
const GENERIC_LOCAL = /^(?:noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|helpdesk)$/i;

function isSafeEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!new RegExp(SAFE_EMAIL_SQL).test(email)) return false;
  if (ENCODED_FRAGMENT.test(email)) return false;
  if (GENERIC_LOCAL.test(email.split("@")[0] ?? "")) return false;
  return true;
}

async function main(): Promise<void> {
  const db = new Database(process.env.DATABASE_URL ?? "");
  try {
    const resourceRows = await db.query<{ id: string; normalized_email: string }>(
      `SELECT id, normalized_email
         FROM public_contact_resource_contacts
        WHERE normalized_email IS NULL
           OR normalized_email !~ '${SAFE_EMAIL_SQL}'`
    );

    let suppressed = 0;
    for (const row of resourceRows.rows) {
      if (row.normalized_email && isSafeEmail(row.normalized_email)) continue;
      await db.query(
        `UPDATE public_contact_resource_contacts
            SET validation_status='INVALID', relevance_score=0, updated_at=NOW()
          WHERE id=$1`,
        [row.id]
      );
      suppressed += 1;
    }

    const activeContacts = await db.query<{ id: string; email: string }>(
      `SELECT id, email
         FROM contacts
        WHERE COALESCE(suppressed,FALSE)=FALSE
          AND email IS NOT NULL`
    );
    let contactSuppressed = 0;
    for (const row of activeContacts.rows) {
      if (isSafeEmail(row.email)) continue;
      await db.query(
        `UPDATE contacts
            SET suppressed=TRUE, validation_status='INVALID', updated_at=NOW()
          WHERE id=$1`,
        [row.id]
      );
      contactSuppressed += 1;
    }

    const validCount = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM public_contact_resource_contacts
        WHERE validation_status IN ('LIKELY','VERIFIED')
          AND relevance_score >= 60
          AND normalized_email ~ '${SAFE_EMAIL_SQL}'`
    );

    console.log(JSON.stringify({
      status: "ok",
      feature: "PUBLIC_CONTACT_RESOURCE_RECONCILIATION",
      malformedResourceContactsSuppressed: suppressed,
      malformedPromotedContactsSuppressed: contactSuppressed,
      validQualifiedResourceContacts: Number(validCount.rows[0]?.count ?? 0),
      applicationsSent: 0,
      outreachSent: 0
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", feature: "PUBLIC_CONTACT_RESOURCE_RECONCILIATION", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
