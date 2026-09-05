import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

export interface RssJobSourceOptions {
  name: string;
  feedUrl: string;
  defaultCompanyName?: string;
}

interface RssItem {
  id: string;
  title: string;
  link: string;
  description: string;
  companyName: string | null;
  publishedAt: Date | null;
  location: string | null;
}

export class RssJobSource implements JobSource {
  readonly name: string;

  constructor(private readonly options: RssJobSourceOptions) {
    this.name = options.name;
  }

  async fetchJobs(): Promise<Job[]> {
    const response = await fetch(this.options.feedUrl, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }
    });

    if (!response.ok) {
      throw new AppError(`RSS request failed: ${response.status}`, {
        code: "JOB_SOURCE_REQUEST_FAILED",
        statusCode: response.status
      });
    }

    const xml = await response.text();
    const items = parseRssItems(xml);
    return items.map((item) => this.normalize(item));
  }

  private normalize(item: RssItem): Job {
    const description = stripHtml(item.description);
    if (!item.id || !item.title || !item.link || !description) {
      throw new AppError("RSS feed returned an incomplete job posting", {
        code: "JOB_SOURCE_INVALID_DATA",
        statusCode: 502
      });
    }

    const location = item.location?.trim() || null;
    const companyName = item.companyName?.trim() || this.options.defaultCompanyName?.trim() || "Unknown";
    const contentHash = createHash("sha256")
      .update([this.name, item.id, item.title, item.link, description].join("|"))
      .digest("hex");

    return {
      source: this.name,
      sourceJobId: item.id,
      url: item.link,
      title: item.title,
      companyName,
      location,
      country: inferCountry(location),
      workplaceType: "remote",
      employmentType: null,
      description,
      postedAt: item.publishedAt,
      updatedAt: null,
      contentHash
    };
  }
}

function parseRssItems(xml: string): RssItem[] {
  const blocks = [...xml.matchAll(/<(?:item|entry)\\b[^>]*>([\\s\\S]*?)<\\/(?:item|entry)>/gi)].map((match) => match[1] ?? "");

  return blocks.flatMap((block, index) => {
    const title = decodeXml(readTag(block, "title") ?? "").trim();
    const description = decodeXml(readTag(block, "description") ?? readTag(block, "summary") ?? readTag(block, "content") ?? "").trim();
    const link = readLink(block)?.trim() ?? "";
    const guid = decodeXml(readTag(block, "guid") ?? readTag(block, "id") ?? link).trim();
    const creator = decodeXml(readTag(block, "dc:creator") ?? readTag(block, "creator") ?? "").trim() || null;
    const publishedRaw = readTag(block, "pubDate") ?? readTag(block, "published") ?? readTag(block, "updated");
    const publishedAt = publishedRaw ? new Date(decodeXml(publishedRaw).trim()) : null;
    const location = decodeXml(readTag(block, "location") ?? "").trim() || null;

    if (!title || !description || !link) return [];

    return [{
      id: guid || `${index}:${link}`,
      title,
      link,
      description,
      companyName: creator,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      location
    }];
  });
}

function readTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(":", "\\:");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, "i"));
  return match?.[1] ?? null;
}

function readLink(xml: string): string | null {
  const textLink = readTag(xml, "link");
  if (textLink) return decodeXml(textLink);

  const atom = xml.match(/<link\\b[^>]*href=["']([^"']+)["'][^>]*\\/?>(?:<\\/link>)?/i);
  return atom?.[1] ?? null;
}

function stripHtml(value: string): string {
  return decodeXml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function inferCountry(location: string | null): string | null {
  if (!location) return null;
  const normalized = location.toLowerCase();
  if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(normalized)) return "India";
  return null;
}
