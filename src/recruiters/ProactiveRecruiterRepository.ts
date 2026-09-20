import { Database } from "../database/Database";
import { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";
import { hasExplicitMailboxEvidence, isMailboxVerifiedForRealSend, recruiterRealSendEligibilitySql } from "./RecruiterMailboxVerification";
import { resolveEmployerDomainFromPublicSearch } from "./RecruiterCompanyDomainResolver";

export interface ProactiveCampaignRecord { sequenceId: string; messageId: string; }

export class ProactiveRecruiterRepository {
  constructor(private readonly database: Database) {}

  async persistCandidate(candidateProfileId: string, candidate: ProactiveRecruiterDiscoveryCandidate): Promise<string | null> {
    if (candidate.employer === "Unknown employer") return null;
    // Public profile evidence often names the employer without exposing its
    // domain in the profile/search result. Resolve that missing domain only
    // through the existing conservative public-search resolver, which requires
    // independent public evidence and never guesses from the company name.
    const domain = normalizeDomain(candidate.employerDomain) || (candidate.employer ? await resolveEmployerDomainFromPublicSearch(candidate.employer) : "");
    if (!domain) return null;
    const email = candidate.email?.trim().toLowerCase() || null;
    if (email && email.split("@")[1]?.toLowerCase() !== domain) return null;

    const relevanceStatus = candidate.evidenceFreshness === "current" ? "CURRENT" : candidate.evidenceFreshness === "recent" ? "RECENT" : candidate.evidenceFreshness === "historical" ? "HISTORICAL" : "UNKNOWN";
    const verificationEvidence = candidate.verificationEvidence ?? [];
    const explicitMailboxEvidence = hasExplicitMailboxEvidence(verificationEvidence);
    const mailboxEvidence = Boolean(email) && explicitMailboxEvidence && isMailboxVerifiedForRealSend({
      verified: candidate.emailStatus === "VERIFIED",
      mailboxEvidence: true,
      verificationEvidence,
      emailStatus: candidate.emailStatus,
      verificationStatus: "mailbox_verified",
      relevanceStatus,
      suppressed: false
    }) && email?.split("@")[1]?.toLowerCase() === domain;
    const persistedEmailStatus = mailboxEvidence ? "VERIFIED" : candidate.emailStatus === "LIKELY" ? "LIKELY" : candidate.emailStatus === "INVALID" ? "INVALID" : "UNVERIFIED";
    const mxStatus = persistedEmailStatus === "LIKELY" || persistedEmailStatus === "VERIFIED" ? "EXISTS" : persistedEmailStatus === "INVALID" ? "MISSING" : "UNKNOWN";
    const verificationStatus = mailboxEvidence ? "mailbox_verified" : persistedEmailStatus === "LIKELY" ? "domain_mx_verified" : persistedEmailStatus === "INVALID" ? "INVALID" : "public-web-unverified";
    const verified = mailboxEvidence;
    const identityKey = buildIdentityKey(candidate, domain);
    const linkedinProfileUrl = isLinkedInProfile(candidate.discoveryUrl) ? canonicalLinkedIn(candidate.discoveryUrl) : null;

    const existing = await this.database.query<{ id: string }>(
      `SELECT id FROM recruiter_contacts
       WHERE company_domain=$1
         AND (identity_key=$2 OR ($3::text IS NOT NULL AND LOWER(linkedin_profile_url)=LOWER($3)) OR ($4::text IS NOT NULL AND LOWER(email)=LOWER($4)))
       ORDER BY CASE WHEN $4::text IS NOT NULL AND LOWER(email)=LOWER($4) THEN 0 WHEN $3::text IS NOT NULL AND LOWER(linkedin_profile_url)=LOWER($3) THEN 1 ELSE 2 END
       LIMIT 1`,
      [domain, identityKey, linkedinProfileUrl, email]
    );

    const params = [
      candidate.employer, domain, email, candidate.recruiterName, candidate.recruiterRole,
      Math.round(candidate.overallConfidence), verified, verificationStatus, candidate.discoverySource,
      persistedEmailStatus, "VALID", mxStatus, mailboxEvidence, JSON.stringify(verificationEvidence), relevanceStatus,
      linkedinProfileUrl, identityKey, email ? "FOUND" : "PENDING"
    ];

    let id = existing.rows[0]?.id;
    if (id) {
      const result = await this.database.query<{ id: string }>(
        `UPDATE recruiter_contacts SET
           company_name=$1, company_domain=$2,
           email=COALESCE(recruiter_contacts.email,$3),
           full_name=COALESCE($4,recruiter_contacts.full_name),
           title=COALESCE($5,recruiter_contacts.title),
           confidence=GREATEST(COALESCE(recruiter_contacts.confidence,0),COALESCE($6,0)),
           verified=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN TRUE ELSE $7 END,
           verification_status=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN 'mailbox_verified' ELSE $8 END,
           discovery_source=$9,
           email_status=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN 'VERIFIED' ELSE $10 END,
           domain_status=$11, mx_status=$12,
           mailbox_evidence=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN TRUE ELSE $13 END,
           verification_evidence=CASE WHEN recruiter_contacts.verified=TRUE AND recruiter_contacts.mailbox_evidence=TRUE AND UPPER(COALESCE(recruiter_contacts.email_status,''))='VERIFIED' AND LOWER(COALESCE(recruiter_contacts.verification_status,''))='mailbox_verified' THEN recruiter_contacts.verification_evidence WHEN $14='[]'::jsonb THEN recruiter_contacts.verification_evidence ELSE $14 END,
           relevance_status=$15,
           linkedin_profile_url=COALESCE(recruiter_contacts.linkedin_profile_url,$16),
           identity_key=COALESCE(recruiter_contacts.identity_key,$17),
           email_discovery_status=CASE WHEN recruiter_contacts.email IS NOT NULL THEN 'FOUND' ELSE $18 END,
           last_seen_at=NOW(), updated_at=NOW()
         WHERE id=$19
         RETURNING id`,
        [...params, id]
      );
      id = result.rows[0]?.id;
    } else {
      const result = await this.database.query<{ id: string }>(
        `INSERT INTO recruiter_contacts (
           company_name, company_domain, email, full_name, title, confidence, verified, verification_status,
           provider, discovery_source, email_status, domain_status, mx_status, mailbox_evidence, verification_evidence,
           relevance_status, linkedin_profile_url, identity_key, email_discovery_status, last_seen_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proactive-public-web',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
         RETURNING id`,
        params
      );
      id = result.rows[0]?.id;
    }
    if (!id) return null;

    const sourceType = candidate.evidenceType !== "job_hiring_evidence"
      ? "public_profile"
      : candidate.evidenceFreshness === "current"
        ? "current_job_posting"
        : candidate.evidenceFreshness === "recent"
          ? "recent_job_posting"
          : candidate.evidenceFreshness === "historical"
            ? "historical_job_posting"
            : "public_profile";
    await this.database.query(
      `INSERT INTO recruiter_contact_sources (recruiter_contact_id,provider,source_url,source_type,confidence,observed_at)
       VALUES ($1,'proactive-public-web',$2,$3,$4,NOW())
       ON CONFLICT (recruiter_contact_id,provider,source_url) DO UPDATE SET confidence=GREATEST(COALESCE(recruiter_contact_sources.confidence,0),EXCLUDED.confidence),observed_at=NOW()`,
      [id, candidate.discoveryUrl, sourceType, Math.round(candidate.overallConfidence)]
    );

    await this.database.query(
      `INSERT INTO recruiter_proactive_evidence (recruiter_contact_id,candidate_profile_id,target_roles,role_match_score,hiring_evidence_score,overall_confidence,evidence_type,evidence_freshness,evidence_date,discovery_source,discovery_url,discovery_evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (recruiter_contact_id,candidate_profile_id,discovery_url) DO UPDATE SET
         target_roles=EXCLUDED.target_roles,
         role_match_score=GREATEST(recruiter_proactive_evidence.role_match_score,EXCLUDED.role_match_score),
         hiring_evidence_score=GREATEST(recruiter_proactive_evidence.hiring_evidence_score,EXCLUDED.hiring_evidence_score),
         overall_confidence=GREATEST(recruiter_proactive_evidence.overall_confidence,EXCLUDED.overall_confidence),
         evidence_freshness=EXCLUDED.evidence_freshness,evidence_date=EXCLUDED.evidence_date,
         discovery_evidence=EXCLUDED.discovery_evidence,updated_at=NOW()`,
      [id, candidateProfileId, JSON.stringify(candidate.targetRoles), Math.round(candidate.roleMatchScore), Math.round(candidate.hiringEvidenceScore), Math.round(candidate.overallConfidence), candidate.evidenceType, candidate.evidenceFreshness, new Date(candidate.evidenceDate), candidate.discoverySource, candidate.discoveryUrl, JSON.stringify(candidate.discoveryEvidence)]
    );
    return id;
  }

  async createProactiveCampaign(input: { recruiterContactId: string; candidateProfileId: string; targetRoles: string[]; subject: string; body: string; }): Promise<ProactiveCampaignRecord | null> {
    const eligible = await this.database.query<{ id: string }>(`SELECT c.id FROM recruiter_contacts c WHERE c.id=$1 AND ${recruiterRealSendEligibilitySql("c")}`, [input.recruiterContactId]);
    if (!eligible.rows[0]) return null;
    const existingContact = await this.database.query<{ email: string }>(`SELECT email FROM recruiter_contacts WHERE id=$1`, [input.recruiterContactId]);
    const email = existingContact.rows[0]?.email;
    if (!email) return null;
    const priorContact = await this.database.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id WHERE s.candidate_profile_id=$1 AND LOWER(m.recipient_email)=LOWER($2) AND m.status IN ('PREPARED','SENDING','SENT')) AS exists`, [input.candidateProfileId, email]);
    if (priorContact.rows[0]?.exists) return null;
    const sequence = await this.database.query<{ id: string }>(`INSERT INTO recruiter_outreach_sequences (recruiter_contact_id,job_opportunity_id,application_id,candidate_profile_id,status,campaign_type,target_roles)
      SELECT $1,NULL,NULL,$2,'READY','PROACTIVE_RECRUITER',$3
      WHERE EXISTS (SELECT 1 FROM recruiter_contacts c WHERE c.id=$1 AND ${recruiterRealSendEligibilitySql("c")})
      ON CONFLICT DO NOTHING RETURNING id`, [input.recruiterContactId, input.candidateProfileId, JSON.stringify(input.targetRoles)]);
    const sequenceId = sequence.rows[0]?.id;
    if (!sequenceId) return null;
    const message = await this.database.query<{ id: string }>(`INSERT INTO recruiter_outreach_messages (sequence_id,message_type,sequence_step,recipient_email,subject,body,status)
      SELECT $1,'INITIAL',0,c.email,$2,$3,'PREPARED' FROM recruiter_contacts c
      WHERE c.id=$4 AND ${recruiterRealSendEligibilitySql("c")} RETURNING id`, [sequenceId, input.subject, input.body, input.recruiterContactId]);
    const messageId = message.rows[0]?.id;
    if (!messageId) return null;
    return { sequenceId, messageId };
  }
}

function buildIdentityKey(candidate: ProactiveRecruiterDiscoveryCandidate, domain: string): string {
  if (isLinkedInProfile(candidate.discoveryUrl)) return `linkedin:${canonicalLinkedIn(candidate.discoveryUrl)}`;
  if (/^https?:\/\//i.test(candidate.discoveryUrl) && candidate.discoveryUrl.startsWith("public-search:") === false) return `profile:${canonicalUrl(candidate.discoveryUrl)}`;
  return `person:${candidate.recruiterName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${domain}`;
}
function isLinkedInProfile(value: string): boolean { try { const url = new URL(value); return url.hostname.toLowerCase().endsWith("linkedin.com") && /^\/in\/[^/]+/i.test(url.pathname); } catch { return false; } }
function canonicalLinkedIn(value: string): string { try { const url = new URL(value); const profile = url.pathname.match(/^\/in\/([^/?#]+)/i)?.[1]; return profile ? `https://www.linkedin.com/in/${profile.toLowerCase()}` : value.toLowerCase().replace(/\/+$/, ""); } catch { return value.toLowerCase().replace(/\/+$/, ""); } }
function canonicalUrl(value: string): string { try { const url = new URL(value); url.hash = ""; ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","trk","trackingId","refId","lipi"].forEach((key) => url.searchParams.delete(key)); return url.toString().replace(/\/$/, ""); } catch { return value.toLowerCase().replace(/\/+$/, ""); } }
function normalizeDomain(value: string): string { return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? ""; }
