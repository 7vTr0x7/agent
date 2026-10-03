import "dotenv/config";
import { promises as dns } from "node:dns";
import { spawn } from "node:child_process";
import path from "node:path";
import { Database } from "../src/database/Database";

interface ContactRow {
  name?: string;
  email?: string;
  title?: string;
  company?: string;
  source_page?: string;
  source_file?: string;
}

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const GENERIC = /^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|helpdesk)$/i;
const HR_ROLE = /hr|human resources|recruit|recruitment|talent acquisition|talent management|people operations|people & culture|staffing|hiring|careers?/i;
const EXCLUDED = /^(octopus technologies|sketch brahma technologies)$/i;

function extract(files: string[]): Promise<ContactRow[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [path.resolve("scripts/extract-contact-resource.py"), ...files], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { err += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || "contact-resource extractor failed"));
        return;
      }
      const rows: ContactRow[] = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line);
          if (!value._summary) rows.push(value as ContactRow);
        } catch {
          // Ignore non-JSON extractor noise; malformed records are not contacts.
        }
      }
      resolve(rows);
    });
  });
}

async function mx(email: string): Promise<"LIKELY" | "UNVERIFIED" | "INVALID"> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "INVALID";
  try {
    return (await dns.resolveMx(domain)).length ? "LIKELY" : "INVALID";
  } catch {
    return "UNVERIFIED";
  }
}

function relevance(row: ContactRow): number {
  // A structured recruiter/contact document is already the source context.
  // Do not require HR wording in the extracted row before accepting a valid address.
  const title = row.title?.trim() ?? "";
  const emailLocal = (row.email?.split("@")[0] ?? "").toLowerCase();
  let score = 80;
  if (HR_ROLE.test(title)) score += 10;
  if (/^(hr|career|careers|recruit|recruiting|talent|jobs|hiring)([._-]|$)/i.test(emailLocal)) score += 10;
  return Math.min(100, score);
}

async function main(): Promise<void> {
  const configured = (process.env.PUBLIC_CONTACT_RESOURCE_PATHS ?? process.env.PUBLIC_CONTACT_RESOURCE_CSV_PATHS ?? "")
    .split(/\s*,\s*/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!configured.length) {
    throw new Error("Set PUBLIC_CONTACT_RESOURCE_PATHS to PDF/DOC/DOCX/XLS/XLSX/CSV/TXT/MD files.");
  }

  const rows = await extract(configured);
  const database = new Database(process.env.DATABASE_URL ?? "");
  let filesProcessed = 0;
  let rowsSeen = 0;
  let invalid = 0;
  let excluded = 0;
  let duplicates = 0;
  let persisted = 0;
  let likely = 0;
  let unverified = 0;

  try {
    for (const configuredPath of configured) {
      const absolute = path.resolve(configuredPath);
      const sourceUrl = "file://" + absolute.replace(/\\/g, "/");
      const fileRows = rows.filter((row) => row.source_file === path.basename(absolute));
      rowsSeen += fileRows.length;

      const resource = await database.query<{ id: string }>(
        `INSERT INTO public_contact_resources(
           source_url, source_type, title, processed_at, status, records_seen
         ) VALUES($1,$2,$3,NOW(),'PROCESSED',$4)
         ON CONFLICT(source_url) DO UPDATE SET
           processed_at=NOW(), status='PROCESSED', title=EXCLUDED.title,
           records_seen=EXCLUDED.records_seen
         RETURNING id`,
        [sourceUrl, path.extname(absolute).slice(1).toUpperCase() || "FILE", path.basename(absolute).slice(0, 300), fileRows.length]
      );
      const resourceId = resource.rows[0]?.id;
      if (!resourceId) throw new Error(`Could not persist resource: ${absolute}`);

      const seen = new Set<string>();
      let resourceInvalid = 0;
      let resourceDuplicates = 0;
      let resourceQualified = 0;

      for (const row of fileRows) {
        const email = row.email?.trim().toLowerCase() ?? "";
        if (!EMAIL.test(email) || GENERIC.test(email.split("@")[0] ?? "")) {
          invalid += 1;
          resourceInvalid += 1;
          continue;
        }
        if (seen.has(email)) {
          duplicates += 1;
          resourceDuplicates += 1;
          continue;
        }
        seen.add(email);

        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain) continue;
        const validationStatus = await mx(email);
        if (validationStatus === "INVALID") {
          invalid += 1;
          resourceInvalid += 1;
          continue;
        }
        if (validationStatus === "LIKELY") likely += 1;
        else unverified += 1;

        const company = row.company?.trim() || domain.split(".")[0]?.replace(/[-_]+/g, " ") || "";
        if (EXCLUDED.test(company)) {
          excluded += 1;
          continue;
        }

        const score = relevance(row);
        resourceQualified += 1;

        const evidence = [
          row.name ? `Name: ${row.name.trim()}` : "",
          row.title ? `Title: ${row.title.trim()}` : "",
          company ? `Company: ${company}` : "",
          row.source_page ? `Source context: ${row.source_page.trim()}` : "",
          `Source file: ${path.basename(absolute)}`
        ].filter(Boolean).join(" | ").slice(0, 3500);

        const result = await database.query(
          `INSERT INTO public_contact_resource_contacts(
             resource_id, normalized_email, domain, validation_status, relevance_score,
             evidence_context, observed_at, updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT(resource_id, normalized_email) DO UPDATE SET
             validation_status=EXCLUDED.validation_status,
             relevance_score=GREATEST(public_contact_resource_contacts.relevance_score, EXCLUDED.relevance_score),
             evidence_context=EXCLUDED.evidence_context,
             updated_at=NOW()
           RETURNING id`,
          [resourceId, email, domain, validationStatus, score, evidence]
        );
        if (result.rowCount === 1) persisted += 1;
        else duplicates += 1;
      }

      await database.query(
        `UPDATE public_contact_resources
            SET emails_extracted=$2, emails_normalized=$3, invalid_emails=$4,
                duplicate_emails=$5, qualified_contacts=$6, processed_at=NOW(), status='PROCESSED'
          WHERE id=$1`,
        [resourceId, fileRows.length, fileRows.length - resourceInvalid, resourceInvalid, resourceDuplicates, resourceQualified]
      );

      filesProcessed += 1;
      console.log(JSON.stringify({
        file: absolute,
        sourceType: path.extname(absolute).slice(1).toUpperCase() || "FILE",
        rows: fileRows.length,
        qualified: resourceQualified
      }));
    }

    console.log(JSON.stringify({
      status: "ok",
      feature: "MULTIFORMAT_CONTACT_RESOURCE",
      filesProcessed,
      rowsSeen,
      invalidEmails: invalid,
      excluded,
      duplicateEmails: duplicates,
      mxLikely: likely,
      mxUnverified: unverified,
      qualifiedContactsPersisted: persisted,
      recruiterIdentityCreated: 0,
      hiringEvidenceClaimed: false,
      mailboxVerificationClaimed: false,
      nextStep: "run promote-public-contact-resources-once.ts; valid document contacts are promoted directly without hiring evidence"
    }, null, 2));
  } finally {
    await database.close();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    status: "FAILED",
    feature: "MULTIFORMAT_CONTACT_RESOURCE",
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
