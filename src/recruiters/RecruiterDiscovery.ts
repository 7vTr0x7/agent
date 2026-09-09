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
  /** True means the configured verification step passed; public-web uses domain MX verification. */
  verified: boolean;
  /** Examples: domain_mx_verified, unverified_public_source, verification_provider_required. */
  verificationStatus?: string;
  provider: string;
  linkedinProfileUrl?: string;
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
  /** Public-web verification means the destination domain advertises an MX receiver; it is not mailbox-level proof. */
  verified: boolean;
  status: string;
  confidence?: number;
}

export interface RecruiterDiscoveryProvider {
  readonly name: string;
  discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult>;
  verify(email: string): Promise<RecruiterVerificationResult>;
}
