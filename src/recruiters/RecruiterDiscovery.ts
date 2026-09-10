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

export interface RecruiterIdentityCandidate {
  email?: string;
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
  linkedinProfileUrl?: string;
  companyDomain?: string;
  recruitingContext?: string;
  discoveryEvidence?: string[];
  discoveredAt?: Date;
  sources: Array<{
    url?: string;
    type?: string;
    confidence?: number;
  }>;
}

/** A legacy email-bearing recruiter contact. New identity-only candidates use RecruiterIdentityCandidate. */
export interface RecruiterContactCandidate extends RecruiterIdentityCandidate {
  email: string;
}

export type RecruiterDiscoveryContact = RecruiterContactCandidate | RecruiterIdentityCandidate;

export interface RecruiterDiscoveryResult {
  provider: string;
  contacts: RecruiterDiscoveryContact[];
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
  /** Optional second-stage email discovery. It must never invent an address. */
  discoverEmails?(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult>;
  verify(email: string): Promise<RecruiterVerificationResult>;
}
