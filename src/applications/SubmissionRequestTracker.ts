import { Page, Request, Response } from "playwright";

export interface SubmissionRequestEvidence {
  requestObserved: boolean;
  requestSentAt: Date | null;
  responseObserved: boolean;
  responseReceivedAt: Date | null;
  responseStatus: number | null;
  finalUrl: string;
}

/**
 * Conservative browser-side evidence tracker. It deliberately records only
 * whether a non-GET request was emitted and whether a response was observed;
 * request URLs and headers are never persisted or logged.
 */
export class SubmissionRequestTracker {
  private requestObserved = false;
  private requestSentAt: Date | null = null;
  private responseObserved = false;
  private responseReceivedAt: Date | null = null;
  private responseStatus: number | null = null;

  private readonly onRequest = (request: Request): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) return;
    if (!this.requestObserved) {
      this.requestObserved = true;
      this.requestSentAt = new Date();
    }
  };

  private readonly onResponse = (response: Response): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(response.request().method().toUpperCase())) return;
    if (!this.responseObserved) {
      this.responseObserved = true;
      this.responseReceivedAt = new Date();
      this.responseStatus = response.status();
    }
  };

  constructor(private readonly page: Page) {}

  start(): void {
    this.page.on("request", this.onRequest);
    this.page.on("response", this.onResponse);
  }

  stop(): void {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
  }

  snapshot(): SubmissionRequestEvidence {
    return {
      requestObserved: this.requestObserved,
      requestSentAt: this.requestSentAt,
      responseObserved: this.responseObserved,
      responseReceivedAt: this.responseReceivedAt,
      responseStatus: this.responseStatus,
      finalUrl: this.page.url()
    };
  }
}
