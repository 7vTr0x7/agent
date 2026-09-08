import { RecruiterContactCandidate } from "./RecruiterDiscovery";

const TITLE_WEIGHTS: Array<[RegExp, number]> = [
  [/technical\s+recruiter/i, 100],
  [/engineering\s+recruiter/i, 98],
  [/talent\s+acquisition\s+(partner|specialist|manager)/i, 96],
  [/technical\s+talent/i, 94],
  [/recruiter/i, 88],
  [/talent\s+acquisition/i, 84],
  [/hiring\s+manager/i, 80],
  [/human\s+resources|\bhr\b/i, 58]
];
const GENERIC_RECRUITING_MAILBOX = /^(careers?|jobs?|recruiting|recruitment|talent|talentacquisition|hr|people|hiring|staffing|joinus|workwithus|humanresources)([._+-].*)?@/i;

export interface RankedRecruiterContact extends RecruiterContactCandidate {
  score: number;
  reasons: string[];
}

export function rankRecruiterContacts(
  contacts: RecruiterContactCandidate[],
  jobTitle: string,
  maxContacts: number
): RankedRecruiterContact[] {
  return contacts
    .map((contact) => {
      let score = 0;
      const reasons: string[] = [];
      const title = contact.title ?? "";
      const email = contact.email.trim().toLowerCase();

      for (const [pattern, weight] of TITLE_WEIGHTS) {
        if (pattern.test(title)) {
          score += weight;
          reasons.push(`title:${title}`);
          break;
        }
      }

      if (/recruit|talent|human resources|\bhr\b|people|hiring|staffing/i.test(contact.department ?? "")) {
        score += 18;
        reasons.push("recruiting-related department");
      }

      if (/senior|lead|manager|partner|director|head|principal|vp/i.test(contact.seniority ?? "")) {
        score += 10;
        reasons.push("senior recruiting signal");
      }

      if (contact.verified) {
        score += 25;
        reasons.push("verified email");
      }

      if (typeof contact.confidence === "number") {
        score += Math.round(contact.confidence / 4);
        reasons.push(`provider confidence:${contact.confidence}`);
      }

      const sourceTypes = new Set((contact.sources ?? []).map((source) => source.type ?? ""));
      if (sourceTypes.has("snov_prospect") || sourceTypes.has("hunter")) {
        score += 8;
        reasons.push("people-data provider source");
      }
      if (sourceTypes.has("job_posting")) {
        score += 12;
        reasons.push("explicit job-posting source");
      }
      if (sourceTypes.has("public_company_page")) {
        score += 8;
        reasons.push("first-party company source");
      }
      if ((contact.sources ?? []).length >= 2) {
        score += 8;
        reasons.push("multiple public source confirmations");
      }

      if (GENERIC_RECRUITING_MAILBOX.test(email)) {
        score += 5;
        reasons.push("recruiting mailbox alias");
      }

      if (jobTitle && /engineer|developer|software|frontend|front.?end|backend|full.?stack|react|next\.js/i.test(jobTitle)) {
        if (/technical|engineering|recruit|talent|hiring/i.test(title) || /recruit|talent|hiring/i.test(contact.department ?? "")) {
          score += 12;
          reasons.push("technical-role alignment");
        }
      }

      return { ...contact, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .slice(0, maxContacts);
}
