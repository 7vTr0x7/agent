import { ClaimedTask, TaskHandler } from "../../queue/TaskQueue";
import { DiscoveryEngine } from "../engine/DiscoveryEngine";
import { DISCOVERY_TASK_TYPE, DiscoveryTaskPayload } from "./DiscoveryTask";

export class DiscoveryTaskHandler {
  constructor(private readonly engine: DiscoveryEngine) {}

  readonly taskHandler: TaskHandler<DiscoveryTaskPayload> = async (
    task: ClaimedTask<DiscoveryTaskPayload>
  ): Promise<void> => {
    if (!task.payload?.sourceId) {
      throw new Error("Discovery task is missing sourceId");
    }

    const result = await this.engine.runSource(task.payload.sourceId);

    if (result.status === "FAILED") {
      throw new Error(`Discovery source failed: ${task.payload.sourceId}`);
    }
  };

  readonly taskType = DISCOVERY_TASK_TYPE;
}
