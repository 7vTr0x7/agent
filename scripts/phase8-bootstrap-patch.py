from pathlib import Path

send = Path('src/recruiters/RecruiterOutreachSendService.ts')
s = send.read_text()
replacements = [
    ('interface ClaimedSendRecord extends RecruiterOutreachMessageRecord { recruiterContactId: string;', 'interface ClaimedSendRecord extends RecruiterOutreachMessageRecord { campaignType: "JOB_RECRUITER" | "PROACTIVE_RECRUITER"; recruiterContactId: string;'),
    ('if (!sequence.jobOpportunityId) return { status: "SKIPPED", messageId: message.id, reason: "Controlled recruiter outreach requires a job-associated sequence." };', 'if (sequence.campaignType === "JOB_RECRUITER" && !sequence.jobOpportunityId) return { status: "SKIPPED", messageId: message.id, reason: "Job-linked recruiter outreach requires a job-associated sequence." };'),
    ('if (this.automationEnabled) return { status: "SKIPPED", messageId: message.id, reason: "Phase 6 controlled activation refuses broad automation; AUTOMATION_ENABLED must remain false." };', 'if (this.automationEnabled && sequence.campaignType === "JOB_RECRUITER") return { status: "SKIPPED", messageId: message.id, reason: "Job-linked controlled activation refuses broad automation; AUTOMATION_ENABLED must remain false." };'),
    ('m.client_message_id AS existing_client_message_id FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s', 'm.client_message_id AS existing_client_message_id,s.campaign_type FROM recruiter_outreach_messages m JOIN recruiter_outreach_sequences s'),
    ('if (row.job_opportunity_id === null) return null;', 'if (row.campaign_type === "JOB_RECRUITER" && row.job_opportunity_id === null) return null;'),
    ('recruiterContactId: row.recruiter_contact_id,', 'campaignType: row.campaign_type, recruiterContactId: row.recruiter_contact_id,'),
]
for old, new in replacements:
    if old not in s:
        raise SystemExit(f'Missing expected send-service source fragment: {old[:120]}')
    s = s.replace(old, new, 1)
send.write_text(s)

repo = Path('src/recruiters/RecruiterDiscoveryRepository.ts')
r = repo.read_text()
old = "WHERE recruiter_contact_id=$1 AND job_opportunity_id=$2 AND candidate_profile_id=$3 AND status <> 'FAILED'"
new = "WHERE recruiter_contact_id=$1 AND candidate_profile_id=$3 AND status <> 'FAILED' AND (job_opportunity_id=$2 OR campaign_type='PROACTIVE_RECRUITER')"
if old not in r:
    raise SystemExit('Missing expected cross-path duplicate query fragment')
r = r.replace(old, new, 1)
old = 'status:"READY"|"ACTIVE"|"PAUSED"|"STOPPED"|"COMPLETED"|"FAILED"; nextActionAt:'
new = 'status:"READY"|"ACTIVE"|"PAUSED"|"STOPPED"|"COMPLETED"|"FAILED"; campaignType:"JOB_RECRUITER"|"PROACTIVE_RECRUITER"; nextActionAt:'
if old not in r:
    raise SystemExit('Missing expected sequence record type fragment')
r = r.replace(old, new, 1)
r = r.replace('SELECT id,recruiter_contact_id,job_opportunity_id,application_id,candidate_profile_id,status,next_action_at,follow_up_count FROM recruiter_outreach_sequences WHERE id=$1', 'SELECT id,recruiter_contact_id,job_opportunity_id,application_id,candidate_profile_id,status,campaign_type,next_action_at,follow_up_count FROM recruiter_outreach_sequences WHERE id=$1', 1)
r = r.replace('RETURNING id,recruiter_contact_id,job_opportunity_id,application_id,candidate_profile_id,status,next_action_at,follow_up_count', 'RETURNING id,recruiter_contact_id,job_opportunity_id,application_id,candidate_profile_id,status,campaign_type,next_action_at,follow_up_count')
r = r.replace('candidateProfileId:row.candidate_profile_id,status:row.status,nextActionAt:', 'candidateProfileId:row.candidate_profile_id,status:row.status,campaignType:row.campaign_type,nextActionAt:')
repo.write_text(r)

ci = Path('.github/workflows/ci.yml')
c = ci.read_text()
old = 'branches: [main, phase4/controlled-real-world-activation, phase5/real-job-recruiter-intelligence, phase6/controlled-real-gmail-activation, phase7/recruiter-discovery-outreach-preparation]'
new = 'branches: [main, phase4/controlled-real-world-activation, phase5/real-job-recruiter-intelligence, phase6/controlled-real-gmail-activation, phase7/recruiter-discovery-outreach-preparation, phase8/recruiter-first-outreach]'
if old not in c:
    raise SystemExit('Missing CI push branch list')
c = c.replace(old, new, 1)
ci.write_text(c)
print('Phase 8 bootstrap source patch applied.')
