import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Database } from "../src/database/Database";
interface CsvRow { sno?: string; name?: string; email?: string; title?: string; company?: string; source_page?: string; }
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const HR_ROLE = /hr|human resources|recruit|recruitment|talent acquisition|talent management|people (?:operations|& culture)|staffing|people partner/i;
const GENERIC = /^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|helpdesk)$/i;
function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]; const next = text[i + 1];
    if (quoted) { if (ch === '"' && next === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch;
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  const header = rows.shift()?.map((value) => value.trim().toLowerCase()) ?? [];
  return rows.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])) as CsvRow);
}
function score(row: CsvRow): number {
  const title = row.title?.trim() ?? ""; const company = row.company?.trim() ?? "";
  let value = HR_ROLE.test(title) ? 80 : 55;
  if (/software|technology|technologies|digital|systems|cloud|data|infotech|tech|ai|analytics|cyber|web|labs/i.test(company)) value += 10;
  if (/technical recruitment|talent acquisition|recruitment head|head of recruitment|engineering recruiter/i.test(title)) value += 10;
  return Math.min(100, value);
}
async function main(): Promise<void> {
  const configured = (process.env.PUBLIC_CONTACT_RESOURCE_CSV_PATHS ?? process.env.PUBLIC_CONTACT_RESOURCE_CSV_PATH ?? "").split(/\s*,\s*/).map((value) => value.trim()).filter(Boolean);
  if (configured.length === 0) throw new Error("Set PUBLIC_CONTACT_RESOURCE_CSV_PATHS to one or more local CSV contact-resource paths.");
  const database = new Database(process.env.DATABASE_URL ?? "");
  let filesProcessed = 0, rowsSeen = 0, emailsNormalized = 0, invalid = 0, duplicates = 0, persisted = 0;
  try {
    for (const configuredPath of configured) {
      const absolute = path.resolve(configuredPath); const text = await fs.readFile(absolute, "utf8"); const rows = parseCsv(text); rowsSeen += rows.length;
      const sourceUrl = "file://" + absolute.replace(/\\/g, "/");
      const resource = await database.query<{ id: string }>("INSERT INTO public_contact_resources(source_url,source_type,title,processed_at,status,records_seen,emails_extracted,emails_normalized,invalid_emails,duplicate_emails,qualified_contacts) VALUES($1,'PDF_CSV_IMPORT',$2,NOW(),'PROCESSED',$3,$3,0,0,0,0) ON CONFLICT(source_url) DO UPDATE SET processed_at=NOW(),status='PROCESSED',title=EXCLUDED.title,records_seen=EXCLUDED.records_seen RETURNING id",[sourceUrl,path.basename(absolute).slice(0,300),rows.length]);
      const resourceId = resource.rows[0]?.id; if (!resourceId) throw new Error("Could not persist resource: " + absolute);
      let qualified = 0, resourceInvalid = 0, resourceDuplicates = 0, resourcePersisted = 0;
      for (const row of rows) {
        const email = row.email?.trim().toLowerCase() ?? "";
        if (!EMAIL.test(email) || GENERIC.test(email.split("@")[0] ?? "")) { invalid += 1; resourceInvalid += 1; continue; }
        const domain = email.split("@")[1]; if (!domain) { invalid += 1; resourceInvalid += 1; continue; }
        const relevanceScore = score(row); if (relevanceScore < 60) continue; qualified += 1; emailsNormalized += 1;
        const evidence = ("Name: " + (row.name ?? "").trim() + " | Title: " + (row.title ?? "").trim() + " | Company: " + (row.company ?? "").trim() + " | Source page: " + (row.source_page ?? "").trim() + " | Source file: " + path.basename(absolute)).slice(0,3500);
        const result = await database.query("INSERT INTO public_contact_resource_contacts(resource_id,normalized_email,domain,validation_status,relevance_score,evidence_context,observed_at,updated_at) VALUES($1,$2,$3,'UNVERIFIED',$4,$5,NOW(),NOW()) ON CONFLICT(resource_id,normalized_email) DO NOTHING RETURNING id",[resourceId,email,domain,relevanceScore,evidence]);
        if (result.rowCount === 1) { persisted += 1; resourcePersisted += 1; } else { duplicates += 1; resourceDuplicates += 1; }
      }
      await database.query("UPDATE public_contact_resources SET emails_extracted=$2,emails_normalized=$3,invalid_emails=$4,duplicate_emails=$5,qualified_contacts=$6,processed_at=NOW(),status='PROCESSED' WHERE id=$1",[resourceId,rows.length,rows.length-resourceInvalid,resourceInvalid,resourceDuplicates,qualified]);
      filesProcessed += 1; console.log(JSON.stringify({file:absolute,rows:rows.length,qualified,persisted:resourcePersisted}));
    }
    console.log(JSON.stringify({status:"ok",feature:"PDF_HR_CONTACT_RESOURCE_IMPORT",filesProcessed,rowsSeen,emailsNormalized,invalidEmails:invalid,duplicateEmails:duplicates,qualifiedContactsPersisted:persisted,mailboxVerificationClaimed:false,nextStep:"run promote-public-contact-resources-once.ts after importer; real sending still requires canonical mailbox verification"},null,2));
  } finally { await database.close(); }
}
void main().catch((error) => { console.error(JSON.stringify({status:"FAILED",feature:"PDF_HR_CONTACT_RESOURCE_IMPORT",error:error instanceof Error?error.message:String(error)},null,2)); process.exitCode=1; });