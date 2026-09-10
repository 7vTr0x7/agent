import { createHash } from "node:crypto";

export function canonicalizeJobUrl(url: string): string {
  const parsed = new URL(url.trim());
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

export function createCanonicalJobId(url: string): string {
  return createHash("sha256").update(canonicalizeJobUrl(url)).digest("hex");
}

/** Stable content identity used to collapse the same posting observed through
 * different feeds/platforms when URL/external-ID identity is unavailable. */
export function createJobContentFingerprint(job: {
  title: string;
  companyName: string;
  location: string | null;
  description: string;
}): string {
  const normalize = (value: string | null) => (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update([
      normalize(job.title),
      normalize(job.companyName),
      normalize(job.location),
      normalize(job.description)
    ].join("\n"))
    .digest("hex");
}
