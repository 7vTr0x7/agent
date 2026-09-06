export interface RuntimeLoopLogger {
  error(meta: Record<string, unknown>, message: string): void;
}

export interface RuntimeLoopOptions {
  name: string;
  intervalMs: number;
  signal: AbortSignal;
  logger: RuntimeLoopLogger;
  runOnce: () => Promise<void>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Runs a periodic runtime task without allowing one transient failure to
 * terminate the entire application runtime. Shutdown remains cooperative via
 * AbortSignal.
 */
export async function runPeriodicLoop(options: RuntimeLoopOptions): Promise<void> {
  while (!options.signal.aborted) {
    try {
      await options.runOnce();
    } catch (error: unknown) {
      options.logger.error({ error, loop: options.name }, "Runtime loop iteration failed; continuing");
    }

    await options.sleep(options.intervalMs, options.signal);
  }
}
