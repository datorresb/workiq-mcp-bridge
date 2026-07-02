/**
 * Restart policy for the bridge watchdog: exponential backoff with a hard
 * attempt cap so a persistently-failing bridge (e.g. a taken port) does not
 * spin in a restart loop.
 */
export class RestartPolicy {
  private attempts = 0;

  constructor(
    private readonly maxRestarts = 5,
    private readonly baseDelayMs = 1000,
    private readonly maxDelayMs = 30_000
  ) {}

  reset(): void {
    this.attempts = 0;
  }

  get attemptCount(): number {
    return this.attempts;
  }

  /**
   * Advance the attempt counter and return the next backoff delay in ms, or
   * `null` once the retry cap has been exceeded.
   */
  nextDelay(): number | null {
    this.attempts += 1;
    if (this.attempts > this.maxRestarts) return null;
    const delay = Math.min(
      this.baseDelayMs * 2 ** (this.attempts - 1),
      this.maxDelayMs
    );
    return delay + Math.floor(Math.random() * 500);
  }
}
