import { Database } from "../database/Database";
import { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";

export interface ProactiveCampaignRecord {
  sequenceId: string;
  messageId: string;
}

export class ProactiveRecruiterRepository {
  constructor(private readonly database: Database) {}

  async persistCandidate(candidateProfileId: string, candidate: ProactiveRecruiterDiscoveryCandidate): Promise<string | null> {
    if (!candidate.email || !candidate.employerDomain || candidate.employer === "Unknown employer") return null;
    const domain = normalizeDomain(candidate.employerDomain);
    const mxStatus = candidate.emailStatus === "LIKELY" || candidate.emailStatus === "VERIFIED" ? "EXISTS" : candidate.emailStatus === "INVALID" ? "MISSING" : "UNKNOWN";
    const mailboxEvidence = candidate.emailStatus === "VERIFIED";
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO recruiter_contacts (
        company_name, company_domain, email, full_name, title, confidence, verified,
        verification_status, provider, discovery_source, email_status, domain_status, mx_status,
        mailbox_evidence, verification_evidence, last_seen_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proactive-public-web',$9,$10,$11,$12,$13,$14,NOW(),NOW())
      ON CONFLICT (company_domain,email) DO UPDATE SET
        company_name=EXCLUDED.company_name,
        full_name=COALESCE(EXCLUDED.full_name,recruiter_contacts.full_name),
        title=COALESCE(EXCLUDED.title,recruiter_contacts.title),
        confidence=GREATEST(COALESCE(recruiter_contacts.confidence,0),COALESCE(EXCLUDED.confidence,0)),
        verified=recruiter_contacts.verified OR EXCLUDED.verified,
        verification_status=EXCLUDED.verification_status,
        discovery_source=EXCLUDED.discovery_source,
        email_status=EXCLUDED.email_status,
        domain_status=EXCLUDED.domain_status,
        mx_status=EXCLUDED.mx_status,
        mailbox_evidence=recruiter_contacts.mailbox_evidence OR EXCLUDED.mailbox_evidence,
        verification_evidence=EXCLUDED.verification_evidence,
        last_seen_at=NOW(),updated_at=NOW()
      RETURNING id`,
      [candidate.employer, domain, candidate.email.toLowerCase(), candidate.recruiterName, candidate.recruiterRole,
        Math.round(candidate.overallConfidence), mailboxEvidence, mailboxEvidence ? "mailbox_verified" : "public-web-unverified", candidate.discoverySource,
        candidate.emailStatus, "VALID", mxStatus, mailboxEvidence, JSON.stringify(candidate.discoveryEvidence)]
    );
    const id = result.rows[0]?.id;
    if (!id) return null;

    await this.database.query(
      `INSERT INTO recruiter_proactive_evidence (
        recruiter_contact_id,candidate_profile_id,target_roles,role_match_score,hiring_evidence_score,
        overall_confidence,evidence_type,evidence_freshness,evidence_date,discovery_source,discovery_url,discovery_evidence
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (recruiter_contact_id,candidate_profile_id,discovery_url) DO UPDATE SET
        target_roles=EXCLUDED.target_roles,role_match_score=GREATEST(recruiter_proactive_evidence.role_match_score,EXCLUDED.role_match_score),
        hiring_evidence_score=GREATEST(recruiter_proactive_evidence.hiring_evidence_score,EXCLUDED.hiring_evidence_score),
        overall_confidence=GREATEST(recruiter_proactive_evidence.overall_confidence,EXCLUDED.overall_confidence),
        evidence_freshness=EXCLUDED.evidence_freshness,evidence_date=EXCLUDED.evidence_date,
        discovery_evidence=EXCLUDED.discovery_evidence,updated_at=NOW()`,
      [id, candidateProfileId, JSON.stringify(candidate.targetRoles), Math.round(candidate.roleMatchScore), Math.round(candidate.hiringEvidenceScore),
        Math.round(candidate.overallConfidence), candidate.evidenceType, candidate.evidenceFreshness, new Date(candidate.evidenceDate),
        candidate.discoverySource, candidate.discoveryUrl, JSON.stringify(candidate.discoveryEvidence)]
    );
    return id;
  }

  async createProactiveCampaign(input: {
    recruiterContactId: string;
    candidateProfileId: string;
    targetRoles: string[];
    subject: string;
    body: string;
  }): Promise<ProactiveCampaignRecord | null> {
    const suppressed = await this.database.query<{ email_suppressed: boolean; domain_suppressed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM recruiter_suppressions s JOIN recruiter_contacts c ON c.id=$1 WHERE LOWER(s.email)=LOWER(c.email)) AS email_suppressed,
              EXISTS (SELECT 1 FROM recruiter_suppressions s JOIN recruiter_contacts c ON c.id=$1 WHERE LOWER(s.company_domain)=LOWER(c.company_domain)) AS domain_suppressed`,
      [input.recruiterContactId]
    );
    if (suppressed.rows[0]?.email_suppressed || suppressed.rows[0]?.domain_suppressed) return null;

    const existingContact = await this.database.query<{ email: string }>(
      `SELECT email FROM recruiter_contacts WHERE id=$1`, [input.recruiterContactId]
    );
    const email = existingContact.rows[0]?.email;
    if (!email) return null;

    const priorContact = await this.database.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM recruiter_outreach_messages m
        JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id
        WHERE s.candidate_profile_id=$1 AND LOWER(m.recipient_email)=LOWER($2)
          AND m.status IN ('PREPARED','SENDING','SENT')
      ) AS exists`,
      [input.candidateProfileId, email]
    );
    if (priorContact.rows[0]?.exists) return null;

    const sequence = await this.database.query<{ id: string }>(
      `INSERT INTO recruiter_outreach_sequences (
        recruiter_contact_id,job_opportunity_id,application_id,candidate_profile_id,status,campaign_type,target_roles
      ) VALUES ($1,NULL,NULL,$2,'READY','PROACTIVE_RECRUITER',$3)
      ON CONFLICT DO NOTHING RETURNING id`,
      [input.recruiterContactId, input.candidateProfileId, JSON.stringify(input.targetRoles)]
    );
    const sequenceId = sequence.rows[0]?.id;
    if (!sequenceId) return null;

    const message = await this.database.query<{ id: string }>(
      `INSERT INTO recruiter_outreach_messages (sequence_id,message_type,sequence_step,recipient_email,subject,body,status)
       VALUES ($1,'INITIAL',0,$2,$3,$4,'PREPARED') RETURNING id`,
      [sequenceId, email, input.subject, input.body]
    );
    const messageId = message.rows[0]?.id;
    if (!messageId) return null;
    return { sequenceId, messageId };
  }
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? value.trim().toLowerCase();
}
