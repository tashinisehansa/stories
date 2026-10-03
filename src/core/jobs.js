// In-process background jobs (AI review, picture generation, publishing).
// A second request for a job that is already running joins the same promise.
export class JobRunner {
  constructor(log) {
    this.log = log;
    this.running = new Map();
  }

  isRunning(key) {
    return this.running.has(key);
  }

  run(key, fn) {
    if (this.running.has(key)) return this.running.get(key);
    const p = (async () => {
      try {
        return await fn();
      } finally {
        this.running.delete(key);
      }
    })();
    this.running.set(key, p);
    // Background callers may not await; make sure failures are logged, not unhandled.
    p.catch((err) => this.log?.error('job.failed', { key, err }));
    return p;
  }

  async idle() {
    while (this.running.size) await Promise.allSettled([...this.running.values()]);
  }
}
