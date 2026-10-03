import { Database } from "../database/Database";
import { QueryResult, QueryResultRow } from "pg";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { ProactiveRecruiterDiscoveryCandidate, hasRequiredRecruiterEvidence } from "./ProactiveRecruiterDiscoveryService";
import { hasExplicitMailboxEvidence, isMailboxVerifiedForRealSend, recruiterRealSendEligibilitySql } from "./RecruiterMailboxVerification";
import { isBlockedEmployerDomain, resolveEmployerDomainFromPublicSearch } from "./RecruiterCompanyDomainResolver";
export interface ProactiveCampaignRecord { sequenceId: string; messageId: string; }
export class ProactiveRecruiterRepository {
  constructor(private readonly database: Database) {}

  private async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[]): Promise<QueryResult<T>> {
    try {
      return await this.database.query<T>(sql, params);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`ProactiveRecruiterRepository query failed: ${detail}; sql=${sql.slice(0, 220)}`);
    }
  }
  async persistCandidate(candidateProfileId: string, candidate: ProactiveRecruiterDiscoveryCandidate): Promise<string | null> {
    if (PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.trim().toLowerCase() === candidate.employer.trim().toLowerCase())) return null;
    if (candidate.contactType !== "EMPLOYER" && !hasRequiredRecruiterEvidence(candidate) && !hasPublicHiringPostIdentityEvidence(candidate)) return null;
    const email = candidate.email?.trim().toLowerCase() || null;
    const emailDomain = email?.split("@")[1]?.toLowerCase() ?? "";
    const observedEmailDomain = emailDomain && !isGenericEmailDomain(emailDomain) ? normalizeDomain(emailDomain) : "";
    const rawEmployer = candidate.employer?.trim() ?? "";
    const recoveredEmployer = rawEmployer === "Unknown employer" ? recoverExplicitEmployerFromEvidence(candidate.discoveryEvidence) ?? (observedEmailDomain || null) : isEmployerIdentityChrome(rawEmployer) ? employerNameFromDomain(candidate.employerDomain ?? observedEmailDomain) : rawEmployer;
    if (!recoveredEmployer) return null;
    const employerName = recoveredEmployer.trim();
    const domain = normalizeDomain(candidate.employerDomain ?? "") || (candidate.employer === "Unknown employer" && observedEmailDomain ? observedEmailDomain : "") || (emailDomain && isCompanyMatchingDomain(emailDomain, employerName) ? normalizeDomain(emailDomain) : "") || (employerName ? await resolveEmployerDomainFromPersistedJobs(this.database, employerName) : "") || (employerName ? await resolveEmployerDomainFromPublicSearch(employerName) : "");
    if (!domain || isBlockedEmployerDomain(domain)) return null;
    const emailConsistent = !email || isEmployerEmailDomainConsistent(emailDomain, domain);
    const persistedEmail = emailConsistent ? email : null;
    const linkedinProfileUrl = isLinkedInProfile(candidate.discoveryUrl) ? canonicalLinkedIn(candidate.discoveryUrl) : null;
    const persistedFullName = normalizeRecruiterNameForLinkedIn(candidate.recruiterName, linkedinProfileUrl);
    let canonicalContactId: string | null = null;
    if (persistedEmail) {
      const contactResult = await this.query<{ id: string }>(`INSERT INTO contacts (company_name,name,email,role,source,updated_at) VALUES ($1,$2,$3::text,$4::text,$5::text,NOW()) ON CONFLICT (email) DO UPDATE SET company_name=COALESCE(NULLIF(contacts.company_name,''),EXCLUDED.company_name),name=COALESCE(contacts.name,EXCLUDED.name),role=COALESCE(contacts.role,EXCLUDED.role),source=COALESCE(contacts.source,EXCLUDED.source),updated_at=NOW() RETURNING id`, [employerName, persistedFullName, persistedEmail, candidate.contactType === "EMPLOYER" ? "Hiring contact" : candidate.recruiterRole, candidate.discoverySource]);
      canonicalContactId = contactResult.rows[0]?.id ?? null;
    }
    const persistedEmailDomain = persistedEmail?.split("@")[1]?.toLowerCase() ?? "";
    const persistedEmailStatus = persistedEmail ? candidate.emailStatus === "VERIFIED" ? "VERIFIED" : candidate.emailStatus === "LIKELY" ? "LIKELY" : candidate.emailStatus === "INVALID" ? "INVALID" : "UNVERIFIED" : "UNVERIFIED";
    const persistedVerificationEvidence = persistedEmail ? (candidate.verificationEvidence ?? []) : [];
    const relevanceStatus = candidate.hiringEvidenceScore > 0 ? (candidate.evidenceFreshness === "current" ? "CURRENT" : candidate.evidenceFreshness === "recent" ? "RECENT" : candidate.evidenceFreshness === "historical" ? "HISTORICAL" : "UNKNOWN") : "UNKNOWN";
    const explicitMailboxEvidence = hasExplicitMailboxEvidence(persistedVerificationEvidence);
    const mailboxEvidence = Boolean(persistedEmail) && explicitMailboxEvidence && isMailboxVerifiedForRealSend({ verified: candidate.emailStatus === "VERIFIED", mailboxEvidence: true, verificationEvidence: persistedVerificationEvidence, emailStatus: persistedEmailStatus, verificationStatus: "mailbox_verified", relevanceStatus, suppressed: false }) && persistedEmailDomain === domain;
    const persistedMxStatus = persistedEmailStatus === "LIKELY" || persistedEmailStatus === "VERIFIED" ? "EXISTS" : persistedEmailStatus === "INVALID" ? "MISSING" : "UNKNOWN";
    const verificationStatus = mailboxEvidence ? "mailbox_verified" : persistedEmailStatus === "LIKELY" ? "domain_mx_verified" : persistedEmailStatus === "INVALID" ? "INVALID" : "public-web-unverified";
    const verified = mailboxEvidence;
    const identityKeyCandidate = persistedEmail ? { ...candidate, email: persistedEmail } : { ...candidate, email: undefined };
    const identityKey = buildIdentityKey(identityKeyCandidate, domain);
    const existing = await this.query<{ id: string }>(`SELECT rc.id FROM recruiter_contacts rc LEFT JOIN contacts canonical_contact ON canonical_contact.id=rc.contact_id WHERE rc.company_domain=$1 AND (rc.identity_key=$2 OR ($3::text IS NOT NULL AND LOWER(rc.linkedin_profile_url)=LOWER($3::text)) OR ($4::text IS NOT NULL AND LOWER(canonical_contact.email)=LOWER($4::text))) ORDER BY CASE WHEN $4::text IS NOT NULL AND LOWER(canonical_contact.email)=LOWER($4::text) THEN 0 WHEN $3::text IS NOT NULL AND LOWER(rc.linkedin_profile_url)=LOWER($3::text) THEN 1 ELSE 2 END LIMIT 1`, [domain, identityKey, linkedinProfileUrl, persistedEmail]);
    const params = [employerName, domain, persistedEmail, persistedFullName, candidate.contactType === "EMPLOYER" ? "Hiring contact" : candidate.recruiterRole, Math.round(candidate.overallConfidence), verified, verificationStatus, candidate.discoverySource, persistedEmailStatus, "VALID", persistedMxStatus, mailboxEvidence, JSON.stringify(persistedVerificationEvidence), relevanceStatus, linkedinProfileUrl, identityKey, persistedEmail ? "FOUND" : "PENDING", canonicalContactId];
    let id = existing.rows[0]?.id;
    if (id) {
      const result = await this.query<{ id: string }>(`UPDATE recruiter_contacts SET company_name=$1, company_domain=$2, contact_id=COALESCE(recruiter_contacts.contact_id,$18), full_name=COALESCE($3,recruiter_contacts.full_name), title=COALESCE($4,recruiter_contacts.title), confidence=GREATEST(COALESCE(recruiter_contacts.confidence,0),COALESCE($5,0)), verified=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN TRUE ELSE $6 END, verification_status=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN 'mailbox_verified' ELSE $7 END, discovery_source=$8, email_status=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN 'VERIFIED' ELSE $9 END, domain_status=$10, mx_status=$11, mailbox_evidence=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN TRUE ELSE $12 END, verification_evidence=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN recruiter_contacts.verification_evidence WHEN $13='[]'::jsonb THEN recruiter_contacts.verification_evidence ELSE $13 END, relevance_status=$14, linkedin_profile_url=COALESCE(recruiter_contacts.linkedin_profile_url,$15), identity_key=COALESCE(recruiter_contacts.identity_key,$16), email_discovery_status=CASE WHEN $18 IS NOT NULL THEN 'FOUND' ELSE $17 END, last_seen_at=NOW(), updated_at=NOW() WHERE id=$19 RETURNING id`, [employerName, domain, persistedFullName, candidate.contactType === "EMPLOYER" ? "Hiring contact" : candidate.recruiterRole, Math.round(candidate.overallConfidence), verified, verificationStatus, candidate.discoverySource, persistedEmailStatus, "VALID", persistedMxStatus, mailboxEvidence, JSON.stringify(persistedVerificationEvidence), relevanceStatus, linkedinProfileUrl, identityKey, persistedEmail ? "FOUND" : "PENDING", canonicalContactId, id]);
      id = result.rows[0]?.id;
    } else {
      const result = await this.query<{ id: string }>(`INSERT INTO recruiter_contacts (company_name, company_domain, contact_id, full_name, title, confidence, verified, verification_status, provider, discovery_source, email_status, domain_status, mx_status, mailbox_evidence, verification_evidence, relevance_status, linkedin_profile_url, identity_key, email_discovery_status, last_seen_at, updated_at) VALUES ($1,$2,$18,$3,$4,$5,$6,$7,'proactive-public-web',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()) RETURNING id`, [employerName, domain, persistedFullName, candidate.contactType === "EMPLOYER" ? "Hiring contact" : candidate.recruiterRole, Math.round(candidate.overallConfidence), verified, verificationStatus, candidate.discoverySource, persistedEmailStatus, "VALID", persistedMxStatus, mailboxEvidence, JSON.stringify(persistedVerificationEvidence), relevanceStatus, linkedinProfileUrl, identityKey, persistedEmail ? "FOUND" : "PENDING", canonicalContactId]);
      id = result.rows[0]?.id;
    }
    if (!id) return null;
    const sourceType = candidate.evidenceType === "job_hiring_evidence" ? candidate.evidenceFreshness === "current" ? "current_job_posting" : candidate.evidenceFreshness === "recent" ? "recent_job_posting" : candidate.evidenceFreshness === "historical" ? "historical_job_posting" : "job_hiring_evidence" : "public_profile";
    await this.query(`INSERT INTO recruiter_contact_sources (recruiter_contact_id,provider,source_url,source_type,confidence,observed_at) VALUES ($1,'proactive-public-web',$2::text,$3::text,$4::numeric,NOW()) ON CONFLICT (recruiter_contact_id,provider,source_url) DO UPDATE SET confidence=GREATEST(COALESCE(recruiter_contact_sources.confidence,0),EXCLUDED.confidence),observed_at=NOW()`, [id, candidate.discoveryUrl, sourceType, Math.round(candidate.overallConfidence)]);
    const relevanceEvidence = { type: candidate.evidenceType, source: candidate.discoverySource, postUrl: candidate.discoveryUrl, contactType: candidate.contactType ?? "PERSON", author: persistedFullName ?? null, authorRole: candidate.recruiterRole ?? null, employer: employerName, employerDomain: domain, targetRoles: candidate.targetRoles, hiringEvidenceScore: candidate.hiringEvidenceScore, evidenceFreshness: candidate.evidenceFreshness, evidence: candidate.discoveryEvidence };\n    await this.query(`UPDATE recruiter_contacts SET relevance_score=GREATEST(COALESCE(relevance_score,0),$2::numeric), relevance_evidence=$3::jsonb, updated_at=NOW() WHERE id=$1`, [id, Math.round(Math.min(100, candidate.roleMatchScore * 0.6 + candidate.hiringEvidenceScore * 0.4)), relevanceEvidence]);
    await this.query(`INSERT INTO recruiter_proactive_evidence (recruiter_contact_id,candidate_profile_id,target_roles,role_match_score,hiring_evidence_score,overall_confidence,evidence_type,evidence_freshness,evidence_date,discovery_source,discovery_url,discovery_evidence) VALUES ($1,$2::text,$3::jsonb,$4::numeric,$5::numeric,$6::numeric,$7::text,$8::text,$9::timestamptz,$10::text,$11::text,$12::jsonb) ON CONFLICT (recruiter_contact_id,candidate_profile_id,discovery_url) DO UPDATE SET target_roles=EXCLUDED.target_roles, role_match_score=GREATEST(recruiter_proactive_evidence.role_match_score,EXCLUDED.role_match_score), hiring_evidence_score=GREATEST(recruiter_proactive_evidence.hiring_evidence_score,EXCLUDED.hiring_evidence_score), overall_confidence=GREATEST(recruiter_proactive_evidence.overall_confidence,EXCLUDED.overall_confidence), evidence_freshness=EXCLUDED.evidence_freshness,evidence_date=EXCLUDED.evidence_date,discovery_evidence=EXCLUDED.discovery_evidence,updated_at=NOW()`, [id, candidateProfileId, JSON.stringify(candidate.targetRoles), Math.round(candidate.roleMatchScore), Math.round(candidate.hiringEvidenceScore), Math.round(candidate.overallConfidence), candidate.evidenceType, candidate.evidenceFreshness, new Date(candidate.evidenceDate), candidate.discoverySource, candidate.discoveryUrl, JSON.stringify(candidate.discoveryEvidence)]);
    return id;
  }
  async createProactiveCampaign(input: { recruiterContactId: string; candidateProfileId: string; targetRoles: string[]; subject: string; body: string; }): Promise<ProactiveCampaignRecord | null> {
    const contact = await this.query<{ company_name: string; company_domain: string; email: string | null }>(`SELECT rc.company_name,rc.company_domain,canonical_contact.email FROM recruiter_contacts rc JOIN contacts canonical_contact ON canonical_contact.id=rc.contact_id WHERE rc.id=$1`, [input.recruiterContactId]);
    const contactRow = contact.rows[0];
    if (!contactRow || PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.trim().toLowerCase() === contactRow.company_name.trim().toLowerCase()) || isBlockedEmployerDomain(contactRow.company_domain)) return null;
    const eligible = await this.query<{ id: string }>(`SELECT c.id FROM recruiter_contacts c WHERE c.id=$1 AND ${recruiterRealSendEligibilitySql("c")}`, [input.recruiterContactId]);
    if (!eligible.rows[0]) return null;
    const existingContact = await this.query<{ email: string | null }>(`SELECT canonical_contact.email FROM recruiter_contacts rc JOIN contacts canonical_contact ON canonical_contact.id=rc.contact_id WHERE rc.id=$1`, [input.recruiterContactId]);
    const email = existingContact.rows[0]?.email;
    if (!email) return null;
    const priorContact = await this.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id WHERE s.candidate_profile_id=$1 AND LOWER(m.recipient_email)=LOWER($2) AND m.status IN ('PREPARED','SENDING','SENT')) AS exists`, [input.candidateProfileId, email]);
    if (priorContact.rows[0]?.exists) return null;
    const sequence = await this.query<{ id: string }>(`INSERT INTO recruiter_outreach_sequences (recruiter_contact_id,job_opportunity_id,application_id,candidate_profile_id,status,campaign_type,target_roles) SELECT $1,NULL,NULL,$2,'READY','PROACTIVE_RECRUITER',$3::jsonb WHERE EXISTS (SELECT 1 FROM recruiter_contacts c WHERE c.id=$1 AND ${recruiterRealSendEligibilitySql("c")}) ON CONFLICT DO NOTHING RETURNING id`, [input.recruiterContactId, input.candidateProfileId, JSON.stringify(input.targetRoles)]);
    const sequenceId = sequence.rows[0]?.id;
    if (!sequenceId) return null;
    const message = await this.query<{ id: string }>(`INSERT INTO recruiter_outreach_messages (sequence_id,message_type,sequence_step,recipient_email,subject,body,status) SELECT $1,'INITIAL',0,canonical_contact.email,$2::text,$3::text,'PREPARED' FROM recruiter_contacts c JOIN contacts canonical_contact ON canonical_contact.id=c.contact_id WHERE c.id=$4 AND ${recruiterRealSendEligibilitySql("c")} RETURNING id`, [sequenceId, input.subject, input.body, input.recruiterContactId]);
    const messageId = message.rows[0]?.id;
    if (!messageId) return null;
    return { sequenceId, messageId };
  }
}
function hasPublicHiringPostIdentityEvidence(candidate: ProactiveRecruiterDiscoveryCandidate): boolean {
  if (candidate.evidenceType !== "job_hiring_evidence") return false;
  if (!candidate.recruiterName?.trim() || !candidate.recruiterRole?.trim() || !candidate.employer?.trim() || candidate.employer === "Unknown employer") return false;
  if (candidate.hiringEvidenceScore <= 0 || !candidate.discoveryUrl) return false;
  let parsed: URL; try { parsed = new URL(candidate.discoveryUrl); } catch { return false; }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || host === "localhost" || host.endsWith(".local") || ["google.com","bing.com","duckduckgo.com","qwant.com","search.yahoo.com","search.brave.com"].some((value) => host === value || host.endsWith(`.${value}`))) return false;
  const evidence = candidate.discoveryEvidence.join(" ").toLowerCase();
  const identityTokens = candidate.recruiterName.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  const employerTokens = candidate.employer.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !["the","and","inc","ltd","llc","corp","company","limited","private","pvt"].includes(token));
  const identityPresent = identityTokens.length >= 2 && identityTokens.every((token) => evidence.includes(token));
  const employerPresent = employerTokens.length === 0 || employerTokens.some((token) => evidence.includes(token)) || (candidate.employerDomain ? evidence.includes(candidate.employerDomain.toLowerCase()) : false);
  const recruitingEvidence = /(recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|human resources|\bhr\b|staffing|hiring|recruitment)/i.test(evidence);
  const hiringEvidence = /(currently hiring|actively hiring|hiring now|we(?:'re| are) hiring|open roles|open positions|hiring for|looking for .*?(?:engineers?|developers?|talent)|join (?:our|my) team|apply (?:here|now)|referrals? welcome)/i.test(evidence);
  return identityPresent && employerPresent && recruitingEvidence && hiringEvidence;
}
function recoverExplicitEmployerFromEvidence(evidence: string[]): string | null { const text = evidence.join(" ").replace(/\s+/g, " ").trim(); const patterns = [/\b[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){1,4}\s*[-—|•:]\s*([A-Z][A-Za-z0-9.&' -]{1,100}?)\s*\|\s*LinkedIn\b/i,/\b(?:at|@)\s+([A-Z][A-Za-z0-9.&' -]{1,100}?)(?=\s+(?:currently|actively|hiring|recruiting|for|on|the|in|\||-|•|,|\.|$))/i]; for (const pattern of patterns) { const value = text.match(pattern)?.[1]?.trim().replace(/[|•,.-]+$/, "").trim(); if (value && !/^linkedin$/i.test(value) && !/^unknown employer$/i.test(value)) return value; } return null; }
function buildIdentityKey(candidate: ProactiveRecruiterDiscoveryCandidate, domain: string): string { if (candidate.email) return `email:${candidate.email.toLowerCase()}`; if (candidate.contactType === "EMPLOYER") return `employer:${domain}`; if (isLinkedInProfile(candidate.discoveryUrl)) return `linkedin:${canonicalLinkedIn(candidate.discoveryUrl)}`; if (/^https?:\/\//i.test(candidate.discoveryUrl) && candidate.discoveryUrl.startsWith("public-search:") === false) return `profile:${canonicalUrl(candidate.discoveryUrl)}`; return `person:${(candidate.recruiterName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${domain}`; }
function isLinkedInProfile(value: string): boolean { try { const url = new URL(value); return url.hostname.toLowerCase().endsWith("linkedin.com") && /^\/in\/[^/]+/i.test(url.pathname); } catch { return false; } }
function canonicalLinkedIn(value: string): string { try { const url = new URL(value); const profile = url.pathname.match(/^\/in\/([^/?#]+)/i)?.[1]; return profile ? `https://www.linkedin.com/in/${profile.toLowerCase()}` : value.toLowerCase().replace(/\/+$/, ""); } catch { return value.toLowerCase().replace(/\/+$/, ""); } }
function canonicalUrl(value: string): string { try { const url = new URL(value); url.hash = ""; ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","trk","trackingId","refId","lipi"].forEach((key) => url.searchParams.delete(key)); return url.toString().replace(/\/$/, ""); } catch { return value.toLowerCase().replace(/\/+$/, ""); } }
async function resolveEmployerDomainFromPersistedJobs(database: Database, employerName: string): Promise<string> { const result = await database.query<{ company_domain: string | null }>(`SELECT company_domain FROM job_opportunities WHERE company_domain IS NOT NULL AND (LOWER(TRIM(company_name)) = LOWER(TRIM($1)) OR LOWER(TRIM(company_name)) LIKE LOWER(TRIM($1)) || '%' OR LOWER(TRIM($1)) LIKE LOWER(TRIM(company_name)) || '%') ORDER BY posted_at DESC NULLS LAST LIMIT 10`, [employerName]); const domains = result.rows.map((row) => normalizeDomain(row.company_domain ?? "")).filter(Boolean); return domains.find((domain) => isCompanyMatchingDomain(domain, employerName)) ?? ""; }
function isCompanyMatchingDomain(domain: string, companyName: string): boolean { const host = normalizeDomain(domain).split(".")[0] ?? ""; const tokens = companyName.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !["the","and","inc","ltd","llc","corp","company","limited","private","pvt"].includes(token)); return tokens.some((token) => host.includes(token)); }
function isGenericEmailDomain(domain: string): boolean { return new Set(["gmail.com","googlemail.com","outlook.com","hotmail.com","live.com","yahoo.com","yahoo.co.in","icloud.com","proton.me","protonmail.com"]).has(domain.toLowerCase()); }
export function isEmployerEmailDomainConsistent(emailDomain: string, companyDomain: string): boolean { const email = normalizeDomain(emailDomain); const company = normalizeDomain(companyDomain); return !email || !company || isGenericEmailDomain(email) || email === company; }
function isEmployerIdentityChrome(value: string): boolean { return /(email\s+or\s+phone|password|forgot\s+password|show\s+password|linkedin\s+facebook\s+x|copy\s+linkedin|skip\s+to|navigation)/i.test(value); }
function employerNameFromDomain(value: string): string | null { const domain = normalizeDomain(value); if (!domain) return null; const label = domain.split(".")[0]?.replace(/[-_]+/g, " ").trim(); return label ? label.replace(/\b\w/g, (char) => char.toUpperCase()) : null; }
export function normalizeRecruiterNameForLinkedIn(name: string | undefined, profileUrl: string | null): string | null {
  const raw = name?.trim();
  if (!raw) return null;
  if (!profileUrl) return raw;
  let slug = "";
  try { slug = new URL(profileUrl).pathname.match(/^\/in\/([^/?#]+)/i)?.[1] ?? ""; } catch { return raw; }
  const profileName = slug.replace(/[-_]+/g, " ").replace(/[0-9]+$/, "").trim();
  if (!profileName) return raw;
  const slugTokens = profileName.toLowerCase().split(/\s+/).filter(Boolean);
  const nameTokens = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  if (nameTokens.length >= 2 && nameTokens.every(token => token.length < 3 || slugTokens.some(slugToken => slugToken === token))) return raw;
  const parts = profileName.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 5 && parts.every(part => /^[a-z][a-z.'-]*$/i.test(part))) return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
  return raw;
}
function normalizeDomain(value: string): string { return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? ""; }
