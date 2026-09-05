export interface ResumeExperience {
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  bullets: readonly string[];
}

export interface ResumeEducation {
  institution: string;
  degree: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  details?: readonly string[];
}

export interface ResumeProfile {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  summary: string;
  skills: readonly string[];
  experience: readonly ResumeExperience[];
  education: readonly ResumeEducation[];
}

export interface TailoredResume {
  jobTitle: string;
  sourceVersion: string;
  summary: string;
  skills: readonly string[];
  experience: readonly ResumeExperience[];
  education: readonly ResumeEducation[];
  atsScore: number;
  matchedKeywords: readonly string[];
  missingKeywords: readonly string[];
  warnings: readonly string[];
}
