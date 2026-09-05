import { TaskQueue } from "../../queue/TaskQueue";
import { SourceRegistry } from "../sources/SourceRegistry";
import { DiscoveryTaskDispatcher } from "./DiscoveryTaskDispatcher";

export class QueuedDiscoveryScheduler {
  private readonly dispatcher: DiscoveryTaskDispatcher;

  constructor(
    private readonly registry: SourceRegistry,
    queue: TaskQueue
  ) {
    this.dispatcher = new DiscoveryTaskDispatcher(queue);
  }

  async enqueueRunnableSources(): Promise<string[]> {
    const taskIds: string[] = [];

    for (const registered of this.registry.listRunnable()) {
      const taskId = await this.dispatcher.enqueueSource(
        registered.descriptor.id,
        priorityForSource(registered.descriptor.type)
      );
      taskIds.push(taskId);
    }

    return taskIds;
  }
}

function priorityForSource(type: string): number {
  switch (type) {
    case "api":
      return 30;
    case "ats":
      return 25;
    case "rss":
      return 20;
    case "structured-data":
      return 15;
    default:
      return 10;
  }
}
