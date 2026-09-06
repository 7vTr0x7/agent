import { InterviewRepository } from "./email/InterviewRepository";
import { InterviewReminderScheduler } from "./email/InterviewReminderScheduler";
import { InterviewReminderTaskDispatcher } from "./email/InterviewReminderTask";
import { InterviewReminderTaskHandler } from "./email/InterviewReminderTaskHandler";
import { ApplicationQueueService } from "./applications/ApplicationQueueService";
import { ApplicationRateLimitPolicy } from "./applications/ApplicationRateLimitPolicy";
import { ApplicationCompanyRateLimitPolicy } from "./applications/ApplicationCompanyRateLimitPolicy";
import { StaleSubmissionMonitor } from "./applications/StaleSubmissionMonitor";

// Compatibility wiring fixes: the constructors below are kept aligned with
// their current domain APIs. Existing runtime behavior remains unchanged.

