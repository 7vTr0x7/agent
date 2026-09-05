import { TaskQueue } from "../../queue/TaskQueue";
import { DISCOVERY_TASK_TYPE, DiscoveryTaskPayload } from "./DiscoveryTask";

export class DiscoveryTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueueSource(sourceId: string, priority = 0): Promise<string> {
    const payload: DiscoveryTaskPayload = { sourceId };

    return this.queue.enqueue({
      taskType: DISCOVERY_TASK_TYPE,
      payload,
      priority
    });
  }
}
