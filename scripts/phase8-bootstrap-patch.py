from pathlib import Path

send = Path('src/recruiters/RecruiterOutreachSendService.ts')
s = send.read_text()
old_new = [
    ('if (!sequence.jobOpportunityId) return { status: "SKIPPED", messageId: message.id, reason: "Controlled recruiter outreach requires a job-associated sequence." };', 'if (sequence.jobOpportunityId !== null && !sequence.jobOpportunityId) return { status: "SKIPPED", messageId: message.id, reason: "Job-linked recruiter outreach requires a job-associated sequence." };'),
    ('if (this.automationEnabled) return { status: "SKIPPED", messageId: message.id, reason: "Phase 6 controlled activation refuses broad automation; AUTOMATION_ENABLED must remain false." };', 'if (this.automationEnabled && sequence.jobOpportunityId !== null) return { status: "SKIPPED", messageId: message.id, reason: "Job-linked controlled activation refuses broad automation; AUTOMATION_ENABLED must remain false." };'),
    ('if (row.job_opportunity_id === null) return null;', 'if (row.job_opportunity_id !== null && !row.job_opportunity_id) return null;'),
]
for old, new in old_new:
    if old in s:
        s = s.replace(old, new, 1)
send.write_text(s)

index = Path('src/index.ts')
i = index.read_text()
old = '  if (!config.automationEnabled) {'
new = '  if (!config.automationEnabled && !config.proactiveRecruiter.enabled) {'
if old in i:
    i = i.replace(old, new, 1)
index.write_text(i)

ci = Path('.github/workflows/ci.yml')
c = ci.read_text()
old = 'branches: [main, phase4/controlled-real-world-activation, phase5/real-job-recruiter-intelligence, phase6/controlled-real-gmail-activation, phase7/recruiter-discovery-outreach-preparation]'
new = 'branches: [main, phase4/controlled-real-world-activation, phase5/real-job-recruiter-intelligence, phase6/controlled-real-gmail-activation, phase7/recruiter-discovery-outreach-preparation, phase8/recruiter-first-outreach]'
if old in c:
    c = c.replace(old, new, 1)
ci.write_text(c)
print('Phase 8 bootstrap source patch applied (idempotent).')
