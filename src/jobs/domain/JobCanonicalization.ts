import { createHash } from "node:crypto";

export function canonicalizeJobUrl(url: string): string {
  const parsed = new URL(url.trim());
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

export function createCanonicalJobId(url: string): string {
  return createHash("sha256")
    .update(canonicalizeJobUrl(url).toLowerCase())
    .digest("hex");
}
