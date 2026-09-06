import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachFollowUpService } from "./RecruiterOutreachFollowUpService";

describe("RecruiterOutreachFollowUpService", () => {
  it("schedules the next step from the initial send date", async () => {
    const initialSentAt = new Date("2026-09-01T10:00:00.000Z");
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
      getInitialOutreachSentAt: jest.fn().mockResolvedValue(initialSentAt),
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

    const service = new RecruiterOutreachFollowUpService(repository, {
      enabled: true,
      dayOffsets: [4, 10, 18]
    });

    await expect(service.scheduleNext("sequence-1")).resolves.toEqual({
      status: "SCHEDULED",
      sequenceId: "sequence-1"
    });

    expect(repository.getInitialOutreachSentAt).toHaveBeenCalledWith("sequence-1");
    const [, nextIndex, scheduledFor] = (repository.scheduleNextRecruiterFollowUp as jest.Mock).mock.calls[0];
    expect(nextIndex).toBe(2);
    expect(scheduledFor.getTime()).toBe(new Date("2026-09-11T10:00:00.000Z").getTime());
  });

  it("does not schedule when the initial send has not been confirmed", async () => {
    const repository = {
      getOutreachSequence: jest.fn().mockResolvedValue({ status: "ACTIVE", followUpCount: 0 }),
      getInitialOutreachSentAt: jest.fn().mockResolvedValue(null),
      scheduleNextRecruiterFollowUp: jest.fn()
    } as unknown as RecruiterDiscoveryRepository;
    const service = new RecruiterOutreachFollowUpService(repository, {
      enabled: true,
      dayOffsets: [4, 10, 18]
    });

    await expect(service.scheduleNext("sequence-1")).resolves.toEqual({
      status: "SKIPPED",
      sequenceId: "sequence-1",
      reason: "Initial recruiter outreach has not been confirmed as sent."
    });
    expect(repository.scheduleNextRecruiterFollowUp).not.toHaveBeenCalled();
  });

  it("does not schedule when follow-ups are disabled", async () => {
    const repository = {
      getOutreachSequence: jest.fn(),
      getInitialOutreachSentAt: jest.fn(),
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
    expect(repository.getInitialOutreachSentAt).not.toHaveBeenCalled();
    expect(repository.scheduleNextRecruiterFollowUp).not.toHaveBeenCalled();
  });
});
