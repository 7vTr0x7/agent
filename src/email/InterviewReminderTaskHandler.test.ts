import { InterviewRepository } from "./InterviewRepository";
import { InterviewReminderTaskHandler } from "./InterviewReminderTaskHandler";
import { EmailNotificationService } from "../notifications/EmailNotificationService";

describe("InterviewReminderTaskHandler", () => {
  test("sends reminder and marks it delivered only after send succeeds", async () => {
    const notifications = {
      interviewReminder: jest.fn().mockResolvedValue(undefined)
    } as unknown as EmailNotificationService;
    const interviews = {
      markReminderSent: jest.fn().mockResolvedValue(undefined)
    } as unknown as InterviewRepository;

    const handler = new InterviewReminderTaskHandler(notifications, interviews);
    await handler.handle({
      id: "task-1",
      taskType: "SEND_INTERVIEW_REMINDER",
      payload: {
        interviewId: "interview-1",
        recipient: "salman@example.com",
        candidateName: "Salman Shaikh",
        jobTitle: "Frontend Engineer",
        companyName: "Example Co",
        interviewDateText: "September 16, 2026",
        interviewTimeText: "3:30 PM",
        timezone: "IST",
        meetingUrl: "https://meet.google.com/example"
      },
      status: "RUNNING",
      priority: 300,
      availableAt: new Date(),
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lockedBy: "worker-1",
      attempts: 1,
      maxAttempts: 3,
      dedupeKey: "interview-reminder:interview-1",
      workerId: "worker-1"
    });

    expect(notifications.interviewReminder).toHaveBeenCalled();
    expect(interviews.markReminderSent).toHaveBeenCalledWith("interview-1");
  });
});
