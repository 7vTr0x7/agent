import {
  extractLinkedInPostPublishedAt,
  extractLinkedInPostPublishedAtFromUrl,
  isWithinLinkedInRecentWindow,
} from "./LinkedInPostDate";

describe("LinkedInPostDate", () => {
  it("decodes the exact publication time from a LinkedIn activity URL", () => {
    const url = "https://www.linkedin.com/posts/sakshi-parmar-b320b017_frontend-engineer-fe2-activity-7496451741580922881-hJOa";
    expect(extractLinkedInPostPublishedAtFromUrl(url)?.toISOString()).toBe("2026-08-21T06:22:52.531Z");
    expect(extractLinkedInPostPublishedAt(url)?.toISOString()).toBe("2026-08-21T06:22:52.531Z");
  });

  it("decodes percent-encoded LinkedIn activity separators", () => {
    const url = "https://www.linkedin.com/posts/innovative%2Dimpact%2Dconsultancy_hiring%2Dopentowork%2Daijobs%2Dactivity%2D7511435406014488576%2DYh9Q";
    expect(extractLinkedInPostPublishedAtFromUrl(url)?.toISOString()).toBe("2026-10-06T20:58:55.141Z");
  });

  it("accepts share IDs in LinkedIn post URLs", () => {
    const url = "https://www.linkedin.com/posts/harshal8411_nodejs-backend-developer-12-years-share-7508370223822012416-Q2DY";
    expect(extractLinkedInPostPublishedAtFromUrl(url)?.toISOString()).toBe("2026-09-23T03:42:40.132Z");
  });

  it("uses the URL timestamp before unreliable page-relative timestamps", () => {
    const url = "https://www.linkedin.com/posts/rishi-shrivastava-tech_hiring-sde1-frontend-activity-7495282431592296448-UuaU";
    const evidence = `${url} Rishi Shrivastava 3d`;
    expect(extractLinkedInPostPublishedAt(evidence)?.toISOString()).toBe("2026-08-18T00:56:27.305Z");
  });

  it("accepts a decoded post only when it is inside the four-month window", () => {
    const now = new Date("2026-10-07T14:00:00.000Z");
    const recent = extractLinkedInPostPublishedAtFromUrl(
      "https://www.linkedin.com/posts/sakshi-parmar-b320b017_frontend-engineer-fe2-activity-7496451741580922881-hJOa"
    );
    const old = extractLinkedInPostPublishedAtFromUrl(
      "https://www.linkedin.com/posts/example_activity-7000000000000000000-AbCd"
    );
    expect(isWithinLinkedInRecentWindow(recent, now)).toBe(true);
    expect(isWithinLinkedInRecentWindow(old, now)).toBe(false);
  });
});
