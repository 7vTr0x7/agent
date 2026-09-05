export interface CandidateProfile {
  id: string;
  yearsExperience: number;
  skills: readonly string[];
  targetTitles: readonly string[];
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  workAuthorization?: string;
  sponsorshipRequired?: boolean;
  noticePeriodDays?: number;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  resumePath?: string;
  standardizedAnswers?: Readonly<Record<string, string | boolean | number>>;
}
