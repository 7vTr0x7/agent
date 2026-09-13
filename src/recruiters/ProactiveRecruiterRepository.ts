import { Database } from "../database/Database";
import { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";
import { hasExplicitMailboxEvidence, isMailboxVerifiedForRealSend, recruiterRealSendEligibilitySql } from "./RecruiterMailboxVerification";
import { RecruiterVerificationEvidence } from "./RecruiterDiscovery";

export interface ProactiveCampaignRecord { sequenceId: string; messageId: string; }

export class ProactiveRecruiterRepository {
  constructor(private readonly database: Database) {}

  async persistCandidate(candidateProfileId: string, candidate: ProactiveRecruiterDiscoveryCandidate): Promise<string | null> {
    if (!candidate.employerDomain || candidate.employer === "Unknown employer") return null;
    const domain = normalizeDomain(candidate.employerDomain);
    const email = candidate.email?.trim().toLowerCase() || null;
    const identityKey = buildIdentityKey(candidate);
    const relevanceStatus = candidate.evidenceFreshness === "current" ? "CURRENT" : candidate.evidenceFreshness === "recent" ? "RECENT" : candidate.evidenceFreshness === "historical" ? "HISTORICAL" : "UNKNOWN";
    const verificationEvidence = candidate.verificationEvidence ?? [];
    const explicitMailboxEvidence = hasExplicitMailboxEvidence(verificationEvidence);
    const mailboxEvidence = !!email && explicitMailboxEvidence && isMailboxVerifiedForRealSend({
      verified: candidate.emailStatus === "VERIFIED",
      mailboxEvidence: true,
      verificationEvidence,
      emailStatus: candidate.emailStatus,
      verificationStatus: "mailbox_verified",
      relevanceStatus,
      suppressed: false
    }) && email.split("@")[1]?.toLowerCase() === domain;
    const persistedEmailStatus = mailboxEvidence ? "VERIFIED" : candidate.emailStatus === "LIKELY" ? "LIKELY" : candidate.emailStatus === "INVALID" ? "INVALID" : email ? "UNVERIFIED" : "UNVERIFIED";
    const mxStatus = persistedEmailStatus === "LIKELY" || persistedEmailStatus === "VERIFIED" ? "EXISTS" : persistedEmailStatus === "INVALID" ? "MISSING" : "UNKNOWN";
    const verificationStatus = mailboxEvidence ? "mailbox_verified" : persistedEmailStatus === "LIKELY" ? "domain_mx_verified" : persistedEmailStatus === "INVALID" ? "INVALID" : "public-web-unverified";
    const verified = mailboxEvidence;

    const existing = await this.database.query<{ id: string }>(
      `SELECT id FROM recruiter_contacts
       WHERE company_domain=$1
         AND (identity_key=$2 OR ($3::text IS NOT NULL AND LOWER(linkedin_profile_url)=LOWER($3)) OR ($4::text IS NOT NULL AND LOWER(email)=LOWER($4)))
       ORDER BY updated_at DESC LIMIT 1`,
      [domain, identityKey, candidate.discoveryUrl, email]
    );

    const result = existing.rows[0]?.id
      ? await this.database.query<{ id: string }>(
          `UPDATE recruiter_contacts
           SET company_name=$1, company_domain=$2, email=COALESCE($3,email), full_name=COALESCE($4,full_name), title=COALESCE($5,title),
               confidence=GREATEST(COALESCE(confidence,0),COALESCE($6,0)), verified=$7, verification_status=$8,
               provider='proactive-public-web', discovery_source=$9, email_status=$10, domain_status='VALID', mx_status=$11,
               mailbox_evidence=$12, verification_evidence=$13, relevance_status=$14, linkedin_profile_url=COALESCE($15,linkedin_profile_url),
               identity_key=COALESCE(identity_key,$16), email_discovery_status=CASE WHEN COALESCE($3,email) IS NULL THEN 'PENDING' ELSE 'FOUND' END,
               last_seen_at=NOW(), updated_at=NOW()
           WHERE id=$17 RETURNING id`,
          [candidate.employer, domain, email, candidate.recruiterName, candidate.recruiterRole, Math.round(candidate.overallConfidence), verified, verificationStatus, candidate.discoverySource, persistedEmailStatus, mxStatus, mailboxEvidence, JSON.stringify(verificationEvidence), relevanceStatus, candidate.discoveryUrl, identityKey, existing.rows[0].id]
        )
      : await this.database.query<{ id: string }>(
          `INSERT INTO recruiter_contacts (company_name, company_domain, email, full_name, title, confidence, verified, verification_status, provider, discovery_source, email_status, domain_status, mx_status, mailbox_evidence, verification_evidence, relevance_status, linkedin_profile_url, identity_key, email_discovery_status, last_seen_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proactive-public-web',$9,$10,'VALID',$11,$12,$13,$14,$15,$16,CASE WHEN $3 IS NULL THEN 'PENDING' ELSE 'FOUND' END,NOW(),NOW())
           RETURNING id`,
          [candidate.employer, domain, email, candidate.recruiterName, candidate.recruiterRole, Math.round(candidate.overallConfidence), verified, verificationStatus, candidate.discoverySource, persistedEmailStatus, mxStatus, mailboxEvidence, JSON.stringify(verificationEvidence), relevanceStatus, candidate.discoveryUrl, identityKey]
        );

    const id = result.rows[0]?.id;
    if (!id) return null;
    await this.persistEvidence(id, candidateProfileId, candidate);
    return id;
  }

  async enrichCandidateEmail(input: {
    recruiterContactId: string;
    email: string;
    emailStatus: "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID";
    verificationEvidence?: RecruiterVerificationEvidence[];
  }): Promise<void> {
    const contact = await this.database.query<{ company_domain: string; relevance_status: string }>(
      `SELECT company_domain,relevance_status FROM recruiter_contacts WHERE id=$1`,
      [input.recruiterContactId]
    );
    const row = contact.rows[0];
    if (!row) return;
    const email = input.email.trim().toLowerCase();
    const verificationEvidence = input.verificationEvidence ?? [];
    const explicitMailboxEvidence = hasExplicitMailboxEvidence(verificationEvidence);
    const mailboxEvidence = explicitMailboxEvidence && isMailboxVerifiedForRealSend({
      verified: input.emailStatus === "VERIFIED",
      mailboxEvidence: true,
      verificationEvidence,
      emailStatus: input.emailStatus,
      verificationStatus: "mailbox_verified",
      relevanceStatus: row.relevance_status,
      suppressed: false
    }) && email.split("@")[1]?.toLowerCase() === row.company_domain.toLowerCase();
    const persistedEmailStatus = mailboxEvidence ? "VERIFIED" : input.emailStatus === "LIKELY" ? "LIKELY" : input.emailStatus === "INVALID" ? "INVALID" : "UNVERIFIED";
    const verificationStatus = mailboxEvidence ? "mailbox_verified" : persistedEmailStatus === "LIKELY" ? "domain_mx_verified" : persistedEmailStatus === "INVALID" ? "INVALID" : "public-web-unverified";
    await this.database.query(
      `UPDATE recruiter_contacts
       SET email=$2,email_status=$3,verification_status=$4,verified=$5,mailbox_evidence=$6,verification_evidence=$7,
           mx_status=CASE WHEN $3 IN ('LIKELY','VERIFIED') THEN 'EXISTS' WHEN $3='INVALID' THEN 'MISSING' ELSE 'UNKNOWN' END,
           email_discovery_status=CASE WHEN $3='INVALID' THEN 'INVALID' ELSE 'FOUND' END,email_discovery_attempted_at=NOW(),updated_at=NOW()
       WHERE id=$1`,
      [input.recruiterContactId, email, persistedEmailStatus, verificationStatus, mailboxEvidence, mailboxEvidence, JSON.stringify(verificationEvidence)]
    );
  }

  private async persistEvidence(id: string, candidateProfileId: string, candidate: ProactiveRecruiterDiscoveryCandidate): Promise<void> {
    await this.database.query(
      `INSERT INTO recruiter_proactive_evidence (recruiter_contact_id,candidate_profile_id,target_roles,role_match_score,hiring_evidence_score,overall_confidence,evidence_type,evidence_freshness,evidence_date,discovery_source,discovery_url,discovery_evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (recruiter_contact_id,candidate_profile_id,discovery_url) DO UPDATE SET
         target_roles=EXCLUDED.target_roles,role_match_score=GREATEST(recruiter_proactive_evidence.role_match_score,EXCLUDED.role_match_score),
         hiring_evidence_score=GREATEST(recruiter_proactive_evidence.hiring_evidence_score,EXCLUDED.hiring_evidence_score),
         overall_confidence=GREATEST(recruiter_proactive_evidence.overall_confidence,EXCLUDED.overall_confidence),
         evidence_freshness=EXCLUDED.evidence_freshness,evidence_date=EXCLUDED.evidence_date,
         discovery_evidence=EXCLUDED.discovery_evidence,updated_at=NOW()`,
      [id, candidateProfileId, JSON.stringify(candidate.targetRoles), Math.round(candidate.roleMatchScore), Math.round(candidate.hiringEvidenceScore), Math.round(candidate.overallConfidence), candidate.evidenceType, candidate.evidenceFreshness, new Date(candidate.evidenceDate), candidate.discoverySource, candidate.discoveryUrl, JSON.stringify(candidate.discoveryEvidence)]
    );
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

function buildIdentityKey(candidate: ProactiveRecruiterDiscoveryCandidate): string {
  if (candidate.discoveryUrl) return `profile:${candidate.discoveryUrl.trim().toLowerCase()}`;
  return `name:${candidate.recruiterName.trim().toLowerCase()}|title:${candidate.recruiterRole.trim().toLowerCase()}`;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? value.trim().toLowerCase();
}
