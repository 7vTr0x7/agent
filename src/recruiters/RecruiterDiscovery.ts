export interface RecruiterDiscoveryInput {
  companyName: string;
  companyDomain: string;
  jobTitle: string;
  jobDescription: string;
  location?: string;
  candidateProfileId: string;
  jobOpportunityId?: string;
  applicationId?: string;
}

export interface RecruiterContactCandidate {
  email: string;
  fullName?: string;
  title?: string;
  department?: string;
  seniority?: string;
  country?: string;
  location?: string;
  confidence?: number;
  verified: boolean;
  verificationStatus?: string;
  provider: string;
  sources: Array<{
    url?: string;
    type?: string;
    confidence?: number;
  }>;
}

export interface RecruiterDiscoveryResult {
  provider: string;
  contacts: RecruiterContactCandidate[];
  discoveredAt: Date;
}

export interface RecruiterVerificationResult {
  email: string;
  verified: boolean;
  status: string;
  confidence?: number;
}

export interface RecruiterDiscoveryProvider {
  readonly name: string;
  discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult>;
  verify(email: string): Promise<RecruiterVerificationResult>;
}
