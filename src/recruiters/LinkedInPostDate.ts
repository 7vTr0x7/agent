export const LINKEDIN_RECENT_POST_MONTHS = 4;

export function linkedinRecentPostCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - LINKEDIN_RECENT_POST_MONTHS);
  return cutoff;
}

function parseDate(value: string): Date | undefined {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

const LINKEDIN_ACTIVITY_ID = /(?:activity-|urn:li:activity:)(\d{15,25})/i;

/**
 * LinkedIn activity IDs embed the post creation timestamp in their high bits.
 * Decoding the ID gives us an exact UTC publication instant even when search
 * engines or the public LinkedIn page only expose a relative age such as 2d.
 */
export function extractLinkedInPostPublishedAtFromUrl(input: string): Date | undefined {
  const match = input.match(LINKEDIN_ACTIVITY_ID);
  if (!match?.[1]) return undefined;
  try {
    const activityId = BigInt(match[1]);
    const epochMilliseconds = activityId >> 22n;
    const milliseconds = Number(epochMilliseconds);
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return undefined;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date : undefined;
  } catch {
    return undefined;
  }
}

function fromEpoch(value: string, now: Date): Date | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function relativeDate(input: string, now: Date): Date | undefined {
  const match = input.match(/\b(\d+)\s*(min(?:ute)?s?|h(?:our)?s?|d(?:ay)?s?|w(?:eek)?s?|mo(?:nth)?s?)\s*(?:ago)?\b/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const milliseconds =
    /^min/.test(unit) ? amount * 60_000 :
    /^h/.test(unit) ? amount * 3_600_000 :
    /^d/.test(unit) ? amount * 86_400_000 :
    /^w/.test(unit) ? amount * 7 * 86_400_000 :
    amount * 30 * 86_400_000;
  const date = new Date(now.getTime() - milliseconds);
  // Relative LinkedIn timestamps are only precise to the displayed unit.
  // Normalize the lower-order fields so two posts both reported as "3d"
  // compare equally and geography can break the tie deterministically.
  if (/^min/.test(unit)) date.setSeconds(0, 0);
  else if (/^h/.test(unit)) date.setMinutes(0, 0, 0);
  else date.setHours(0, 0, 0, 0);
  return date;
}

export function extractLinkedInPostPublishedAt(input: string, now = new Date()): Date | undefined {
  const urlDate = extractLinkedInPostPublishedAtFromUrl(input);
  if (urlDate) return urlDate;
  const raw = input.slice(0, 200_000);

  const metaPatterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|datepublished|publish_date|published_time)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|datepublished|publish_date|published_time)["']/i,
  ];
  for (const pattern of metaPatterns) {
    const value = raw.match(pattern)?.[1];
    const date = value ? parseDate(value) : undefined;
    if (date) return date;
  }

  for (const block of raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed: unknown = JSON.parse(block[1] ?? "");
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        for (const key of ["datePublished", "dateCreated", "publishedAt"]) {
          const value = record[key];
          if (typeof value === "string") {
            const date = parseDate(value);
            if (date) return date;
          }
        }
        for (const value of Object.values(record)) if (value && typeof value === "object") queue.push(value);
      }
    } catch {}
  }

  const time = raw.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i)?.[1];
  if (time) {
    const date = parseDate(time);
    if (date) return date;
  }

  for (const pattern of [
    /["'](?:publishedAt|datePublished|dateCreated|timePublished)["']\s*[:=]\s*["']([^"']+)["']/i,
    /["'](?:createdAt|created_at)["']\s*[:=]\s*["']?(\d{10,13})["']?/i,
  ]) {
    const value = raw.match(pattern)?.[1];
    const date = value?.match(/^\d{10,13}$/) ? fromEpoch(value, now) : value ? parseDate(value) : undefined;
    if (date) return date;
  }

  const explicit = raw.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,|\s+)\s*20\d{2}\b/i)?.[0]
    ?? raw.match(/\b20\d{2}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/i)?.[0];
  if (explicit) {
    const date = parseDate(explicit);
    if (date) return date;
  }

  return relativeDate(raw, now);
}

export function isWithinLinkedInRecentWindow(date: Date | undefined, now = new Date()): boolean {
  return Boolean(date && date.getTime() >= linkedinRecentPostCutoff(now).getTime() && date.getTime() <= now.getTime() + 86_400_000);
}
