import "dotenv/config";
import { promises as dns } from "node:dns";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { sourceList } from "../src/recruiters/PublicSearchProviderRegistry";
import { Database } from "../src/database/Database";

type ContactRow = { name?: string; email?: string; title?: string; company?: string; source_page?: string };
type FileType = "PDF" | "CSV" | "XLS" | "XLSX" | "DOC" | "DOCX";
const EXT = /\.(pdf|csv|xls|xlsx|doc|docx)(?:$|[?#])/i;
const SIGNAL = /(recruit|recruiter|recruitment|talent|human[-_ ]?resources?|\bhr\b|career|careers|hiring|jobs?|contact)/i;
const SUSPICIOUS = /(breach|leak(?:ed)?|dump|credential|password|login|database[-_ ]?dump|stolen|hack(?:ed)?|pastebin)/i;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const GENERIC = /^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|helpdesk)$/i;
const HR_ROLE = /hr|human resources|recruit|recruitment|talent acquisition|talent management|people operations|people & culture|staffing|hiring|careers?/i;
const EXCLUDED = /^(octopus technologies|sketch brahma technologies)$/i;

function fileType(url: string, contentType = ""): FileType | null {
  const value = url.toLowerCase();
  if (/\.xlsx(?:$|[?#])/.test(value) || /spreadsheetml|excel/.test(contentType)) return "XLSX";
  if (/\.xls(?:$|[?#])/.test(value)) return "XLS";
  if (/\.docx(?:$|[?#])/.test(value) || /wordprocessingml/.test(contentType)) return "DOCX";
  if (/\.doc(?:$|[?#])/.test(value) || contentType.includes("msword")) return "DOC";
  if (/\.csv(?:$|[?#])/.test(value) || contentType.includes("csv")) return "CSV";
  if (/\.pdf(?:$|[?#])/.test(value) || contentType.includes("pdf")) return "PDF";
  return null;
}

function legitimateResourceUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && !SUSPICIOUS.test(value) &&
      !/(google|bing|duckduckgo|qwant|startpage|search\.yahoo|pastebin)/i.test(u.hostname);
  } catch { return false; }
}

function extractUrls(text: string): string[] {
  const urls = [
    ...(text.match(/https?:\/\/[^\s<>()\]"]+/gi) ?? []),
    ...[...text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => String(m[1] ?? ""))
  ];
  return [...new Set(urls.map((u) => u.replace(/[>.,;:!?]+$/g, ""))
    .filter((u) => EXT.test(u) && SIGNAL.test(u) && legitimateResourceUrl(u)))];
}

async function publicHost(hostname: string): Promise<boolean> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every(({ address }) => {
      const p = address.split(".").map(Number);
      if (p.length === 4 && p.every(Number.isInteger)) {
        const a = p[0] ?? 0, b = p[1] ?? 0;
        return !(a === 10 || a === 127 || (a === 192 && b === 168) ||
          (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254));
      }
      return !address.startsWith("fc") && !address.startsWith("fd") && address !== "::1";
    });
  } catch { return false; }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function download(url: string): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string } | null> {
  let current = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    const parsed = new URL(current);
    if (!legitimateResourceUrl(current) || !(await publicHost(parsed.hostname))) return null;
    const response = await fetchWithTimeout(current, {
      redirect: "manual",
      headers: {
        accept: "application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.2",
        "user-agent": "job-agent-public-contact-file-discovery/1.0"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, current).toString();
      continue;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !fileType(current, contentType)) return null;
    const max = Number(process.env.PUBLIC_CONTACT_RESOURCE_MAX_BYTES ?? 8 * 1024 * 1024);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > max) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > max) return null;
    return { bytes, contentType, finalUrl: response.url || current };
  }
  return null;
}

function extractFile(file: string): Promise<ContactRow[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [path.resolve("scripts/extract-contact-resource.py"), file], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.trim() || "extractor failed"));
      const rows: ContactRow[] = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try { const value = JSON.parse(line); if (!value._summary) rows.push(value); } catch {}
      }
      resolve(rows);
    });
  });
}

const mxCache = new Map<string, "LIKELY" | "UNVERIFIED" | "INVALID">();

async function mx(email: string): Promise<"LIKELY" | "UNVERIFIED" | "INVALID"> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "INVALID";
  const cached = mxCache.get(domain);
  if (cached) return cached;
  let status: "LIKELY" | "UNVERIFIED" | "INVALID";
  try { status = (await dns.resolveMx(domain)).length ? "LIKELY" : "INVALID"; } catch { status = "UNVERIFIED"; }
  mxCache.set(domain, status);
  return status;
}

function relevance(row: ContactRow): number {
  const title = row.title ?? "";
  const local = (row.email?.split("@")[0] ?? "").toLowerCase();
  let score = 45;
  if (HR_ROLE.test(title)) score += 35;
  if (/technical|engineering|developer|talent acquisition|recruitment head/i.test(title)) score += 10;
  if (/^(hr|career|careers|recruit|recruiting|talent|jobs|hiring)([._-]|$)/i.test(local)) score += 10;
  return Math.min(100, score);
}

async function main(): Promise<void> {
  const queries = [
    '"React" "Bengaluru" recruiter filetype:pdf',
    '"React" "Bangalore" "HR" filetype:xlsx',
    '"frontend developer" India recruiter filetype:csv',
    '"talent acquisition" India filetype:xls',
    '"careers" "hiring" India filetype:docx',
    '"HR contact" India recruiter filetype:doc'
  ];
  const requests = queries.flatMap((query) => sourceList(query).map((source) => ({ query, url: source.url })));
  const pages = await mapLimit(requests.slice(0, Number(process.env.PUBLIC_CONTACT_FILE_MAX_SEARCHES ?? 30)), 4, async (item) => {
    try {
      const r = await fetchWithTimeout(item.url, { headers: { accept: "text/html,text/plain,*/*;q=0.2", "user-agent": "job-agent-public-contact-file-discovery/1.0" } }, 10000);
      return { query: item.query, text: r.ok ? await r.text() : "" };
    } catch { return { query: item.query, text: "" }; }
  });
  const candidates = new Map<string, string>();
  for (const page of pages) for (const url of extractUrls(page.text)) candidates.set(url, page.query);
  for (const seed of (process.env.PUBLIC_CONTACT_RESOURCE_SEED_URLS ?? "").split(/\s*,\s*/).map((v) => v.trim()).filter(Boolean)) {
    if (EXT.test(seed) && legitimateResourceUrl(seed)) candidates.set(seed, "configured-seed");
  }

  const db = new Database(process.env.DATABASE_URL ?? "");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-agent-contact-files-"));
  let downloaded = 0, processed = 0, rows = 0, qualified = 0, persisted = 0, invalid = 0, duplicates = 0;
  const results: Record<string, unknown>[] = [];

  try {
    for (const [url, query] of [...candidates.entries()].slice(0, Number(process.env.PUBLIC_CONTACT_FILE_MAX_FILES ?? 20))) {
      let file: { bytes: Uint8Array; contentType: string; finalUrl: string } | null = null;
    try { file = await download(url); } catch { file = null; }
      if (!file) continue;
      downloaded += 1;
      const parsed = new URL(file.finalUrl);
      const type = fileType(file.finalUrl, file.contentType);
      if (!type) continue;
      const tempPath = path.join(tempDir, String(downloaded) + "-resource." + type.toLowerCase());
      await fs.writeFile(tempPath, file.bytes);

      let extracted: ContactRow[];
      try { extracted = await extractFile(tempPath); } catch { continue; }
      processed += 1;
      rows += extracted.length;

      const resource = await db.query<{ id: string }>(
        "INSERT INTO public_contact_resources(source_url,source_type,title,processed_at,status,records_seen) VALUES($1,$2,$3,NOW(),'PROCESSED',$4) ON CONFLICT(source_url) DO UPDATE SET processed_at=NOW(),status='PROCESSED',title=EXCLUDED.title,records_seen=EXCLUDED.records_seen RETURNING id",
        [file.finalUrl, type, path.basename(parsed.pathname).slice(0, 300), extracted.length]
      );
      const resourceId = resource.rows[0]?.id;
      if (!resourceId) continue;

      const seen = new Set<string>();
      let resourceQualified = 0;
      for (const row of extracted) {
        const email = row.email?.trim().toLowerCase() ?? "";
        if (!EMAIL.test(email) || GENERIC.test(email.split("@")[0] ?? "")) { invalid += 1; continue; }
        if (seen.has(email)) { duplicates += 1; continue; }
        seen.add(email);
        if (EXCLUDED.test(row.company ?? "")) continue;
        const status = await mx(email);
        if (status === "INVALID") { invalid += 1; continue; }
        const score = relevance(row);
        if (score < 60) continue;
        resourceQualified += 1;
        const evidence = [
          "Search query: " + query,
          row.name ? "Name: " + row.name : "",
          row.title ? "Title: " + row.title : "",
          row.company ? "Company: " + row.company : "",
          row.source_page ? "Source context: " + row.source_page : "",
          "Downloaded file: " + file.finalUrl
        ].filter(Boolean).join(" | ").slice(0, 3500);
        const result = await db.query(
          "INSERT INTO public_contact_resource_contacts(resource_id,normalized_email,domain,validation_status,relevance_score,evidence_context,observed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT(resource_id,normalized_email) DO UPDATE SET validation_status=EXCLUDED.validation_status,relevance_score=GREATEST(public_contact_resource_contacts.relevance_score,EXCLUDED.relevance_score),evidence_context=EXCLUDED.evidence_context,updated_at=NOW() RETURNING id",
          [resourceId, email, email.split("@")[1], status, score, evidence]
        );
        if (result.rowCount === 1) persisted += 1; else duplicates += 1;
      }
      qualified += resourceQualified;
      await db.query(
        "UPDATE public_contact_resources SET emails_extracted=$2,emails_normalized=$2,qualified_contacts=$3 WHERE id=$1",
        [resourceId, extracted.length, resourceQualified]
      );
      results.push({ url: file.finalUrl, type, rows: extracted.length, qualified: resourceQualified });
    }

    console.log(JSON.stringify({
      status: "ok",
      feature: "PUBLIC_DOWNLOADABLE_CONTACT_RESOURCES",
      discovered: candidates.size,
      downloaded,
      processed,
      rowsExtracted: rows,
      qualifiedContacts: qualified,
      persisted,
      invalid,
      duplicates,
      results,
      mailboxVerificationClaimed: false,
      recruiterIdentityCreated: 0,
      hiringEvidenceClaimed: false
    }, null, 2));
  } finally {
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "FAILED",
    feature: "PUBLIC_DOWNLOADABLE_CONTACT_RESOURCES",
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
