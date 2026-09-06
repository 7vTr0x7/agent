import { InterviewReminderScheduler } from "./InterviewReminderScheduler";
import { InterviewRepository } from "./InterviewRepository";
import { InterviewReminderTaskDispatcher } from "./InterviewReminderTask";

describe("InterviewReminderScheduler", () => {
  test("queues due interviews with complete schedule details", async () => {
    const interviews = {
      findDueReminders: jest.fn().mockResolvedValue([
        {
          id: "interview-1",
          applicationId: "app-1",
          jobTitle: "Frontend Engineer",
          companyName: "Example Co",
          dateText: "September 16, 2026",
          timeText: "3:30 PM",
          timezone: "IST",
          meetingUrl: "https://meet.google.com/example"
        }
      ])
    } as unknown as InterviewRepository;

    const dispatcher = {
      enqueue: jest.fn().mockResolvedValue("task-1")
    } as unknown as InterviewReminderTaskDispatcher;

    const scheduler = new InterviewReminderScheduler(
      interviews,
      dispatcher,
      "salman@example.com",
      "Salman Shaikh"
    );

    const result = await scheduler.runOnce(new Date("2026-09-15T10:00:00Z"));

    expect(result).toEqual({ found: 1, queued: 1 });
    expect(dispatcher.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      interviewId: "interview-1",
      recipient: "salman@example.com",
      candidateName: "Salman Shaikh"
    }));
  });

  test("does not queue incomplete schedule details", async () => {
    const interviews = {
      findDueReminders: jest.fn().mockResolvedValue([
        {
          id: "interview-2",
          applicationId: "app-2",
          jobTitle: "Frontend Engineer",
          companyName: "Example Co",
          dateText: "September 16, 2026",
          timeText: null,
          timezone: null,
          meetingUrl: null
        }
      ])
    } as unknown as InterviewRepository;
    const dispatcher = { enqueue: jest.fn() } as unknown as InterviewReminderTaskDispatcher;

    const scheduler = new InterviewReminderScheduler(
      interviews,
      dispatcher,
      "salman@example.com",
      "Salman Shaikh"
    );

    expect(await scheduler.runOnce()).toEqual({ found: 1, queued: 0 });
    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });
});
