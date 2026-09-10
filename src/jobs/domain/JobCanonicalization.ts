import { createHash } from "node:crypto";

export function canonicalizeJobUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|source$|campaign$|tracking|trk$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function createCanonicalJobId(value: string): string {
  return createHash("sha256").update(canonicalizeJobUrl(value)).digest("hex");
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
