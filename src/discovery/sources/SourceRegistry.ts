import { JobSource } from "../../jobs/sources/JobSource";
import {
  isSourceRunnable,
  SourceDescriptor
} from "../policy/SourcePolicy";

export interface RegisteredSource {
  readonly descriptor: SourceDescriptor;
  readonly source: JobSource;
}

export class SourceRegistry {
  private readonly sources = new Map<string, RegisteredSource>();

  register(registeredSource: RegisteredSource): void {
    const { descriptor, source } = registeredSource;

    if (descriptor.id !== source.name) {
      throw new Error(
        `Source descriptor id "${descriptor.id}" must match source name "${source.name}"`
      );
    }

    if (this.sources.has(descriptor.id)) {
      throw new Error(`Source is already registered: ${descriptor.id}`);
    }

    this.sources.set(descriptor.id, registeredSource);
  }

  get(id: string): RegisteredSource | null {
    return this.sources.get(id) ?? null;
  }

  listRunnable(): RegisteredSource[] {
    return [...this.sources.values()].filter(({ descriptor }) =>
      isSourceRunnable(descriptor)
    );
  }

  list(): RegisteredSource[] {
    return [...this.sources.values()];
  }
}
