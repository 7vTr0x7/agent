export interface JobObservation {
  id: string;
  jobOpportunityId: string;
  platform: string;
  sourceType: string;
  sourceJobId: string | null;
  sourceUrl: string;
  discoveredAt: Date;
  observedAt: Date;
  rawPayload: Record<string, unknown>;
  contentHash: string;
  sourceMetadata: Record<string, unknown> | null;
  createdAt: Date;
}
