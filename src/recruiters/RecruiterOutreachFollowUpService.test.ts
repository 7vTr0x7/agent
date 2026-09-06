import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachFollowUpService } from "./RecruiterOutreachFollowUpService";

describe("RecruiterOutreachFollowUpService", () => {
  it("schedules the next step after a previous follow-up is already due", async () => {
    const repository = {
      getOutreachSequence: jest.fn().mockResolvedValue({
        id: "sequence-1",
        recruiterContactId: "contact-1",
        jobOpportunityId: "job-1",
        applicationId: "application-1",
        candidateProfileId: "candidate-1",
        status: "ACTIVE",
        nextActionAt: new Date(Date.now() - 60_000),
        followUpCount: 1
      }),
      scheduleNextRecruiterFollowUp: jest.fn().mockImplementation(async (_id, nextIndex, scheduledFor) => ({
        id: "sequence-1",
        recruiterContactId: "contact-1",
        jobOpportunityId: "job-1",
        applicationId: "application-1",
        candidateProfileId: "candidate-1",
        status: "ACTIVE",
        nextActionAt: scheduledFor,
        followUpCount: nextIndex
      }))
    } as unknown as RecruiterDiscoveryRepository;

    const before = Date.now();
    const service = new RecruiterOutreachFollowUpService(repository, {
      enabled: true,
      dayOffsets: [4, 10, 18]
    });

    await expect(service.scheduleNext("sequence-1")).resolves.toEqual({
      status: "SCHEDULED",
      sequenceId: "sequence-1"
    });

    expect(repository.scheduleNextRecruiterFollowUp).toHaveBeenCalledTimes(1);
    const [, nextIndex, scheduledFor] = (repository.scheduleNextRecruiterFollowUp as jest.Mock).mock.calls[0];
    expect(nextIndex).toBe(2);
    expect(scheduledFor.getTime()).toBeGreaterThan(before + 9 * 24 * 60 * 60 * 1000);
  });

  it("does not schedule when follow-ups are disabled", async () => {
    const repository = {
      getOutreachSequence: jest.fn(),
      scheduleNextRecruiterFollowUp: jest.fn()
    } as unknown as RecruiterDiscoveryRepository;
    const service = new RecruiterOutreachFollowUpService(repository, {
      enabled: false,
      dayOffsets: [4, 10, 18]
    });

    await expect(service.scheduleNext("sequence-1")).resolves.toEqual({
      status: "SKIPPED",
      sequenceId: "sequence-1",
      reason: "Recruiter follow-ups are disabled."
    });
    expect(repository.getOutreachSequence).not.toHaveBeenCalled();
    expect(repository.scheduleNextRecruiterFollowUp).not.toHaveBeenCalled();
  });
});
