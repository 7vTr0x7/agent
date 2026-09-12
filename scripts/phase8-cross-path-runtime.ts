import { Database } from "../src/database/Database";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the Phase 8 cross-path fixture");

  const db = new Database(databaseUrl);
  const contact = await db.query<{ id: string }>(`SELECT id FROM recruiter_contacts WHERE LOWER(email)=LOWER('alex.recruiter@phase7.test') LIMIT 1`);
  const contactId = contact.rows[0]?.id;
  if (!contactId) throw new Error("Phase 7 recruiter contact not found");

  const candidateProfileId = "phase7-fixture-candidate";
  const jobId = "70000000-0000-4000-8000-000000000001";
  const repo = new RecruiterDiscoveryRepository(db);
  const proactive = new ProactiveRecruiterRepository(db);

  const cleanup = async (): Promise<void> => {
    await db.query(
      `DELETE FROM recruiter_outreach_messages
       WHERE sequence_id IN (
         SELECT id FROM recruiter_outreach_sequences
         WHERE recruiter_contact_id=$1 AND candidate_profile_id=$2
       )`,
      [contactId, candidateProfileId]
    );
    await db.query(
      `DELETE FROM recruiter_outreach_sequences
       WHERE recruiter_contact_id=$1 AND candidate_profile_id=$2`,
      [contactId, candidateProfileId]
    );
  };

  try {
    await cleanup();

    const jobSeq = await repo.createOutreachSequence({
      recruiterContactId: contactId,
      jobOpportunityId: jobId,
      candidateProfileId
    });
    if (!jobSeq) throw new Error("Could not create job-linked baseline sequence");

    let jobFirstBlocked = false;
    try {
      await proactive.createProactiveCampaign({
        recruiterContactId: contactId,
        candidateProfileId,
        targetRoles: ["React Developer"],
        subject: "Phase 8 cross-path test",
        body: "Proactive cross-path fixture"
      });
    } catch {
      jobFirstBlocked = true;
    }
    if (!jobFirstBlocked) throw new Error("JOB -> PROACTIVE cross-path duplicate was not blocked");

    await cleanup();

    const proactiveSeq = await proactive.createProactiveCampaign({
      recruiterContactId: contactId,
      candidateProfileId,
      targetRoles: ["React Developer"],
      subject: "Phase 8 cross-path test",
      body: "Proactive cross-path fixture"
    });
    if (!proactiveSeq) throw new Error("Could not create proactive baseline sequence");

    let proactiveFirstBlocked = false;
    try {
      await repo.createOutreachSequence({
        recruiterContactId: contactId,
        jobOpportunityId: jobId,
        candidateProfileId
      });
    } catch {
      proactiveFirstBlocked = true;
    }
    if (!proactiveFirstBlocked) throw new Error("PROACTIVE -> JOB cross-path duplicate was not blocked");

    console.log(JSON.stringify({
      status: "ok",
      jobFirst: "blocked",
      proactiveFirst: "blocked",
      sameRecruiter: true,
      sameCandidate: true
    }));
  } finally {
    await cleanup();
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
