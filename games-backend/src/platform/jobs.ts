// ─── Scheduled jobs that cannot trip over themselves ─────────────────────────
// The server runs a dozen jobs on timers: notifications, season sealing, the
// chain indexer. A bare setInterval has three problems, all of which matter the
// day the database is slow:
//
//   - if a run takes longer than its interval, the next one starts on top of
//     it, and they pile up (and may notify a player twice)
//   - a job that throws either dies silently or surfaces as an unhandled
//     rejection with no name attached
//   - nothing records whether a job last ran, or how long it took
//
// `every` fixes all three: one run at a time, every failure caught and logged
// under the job's name, and a status line per job for /internal/metrics.
//
// It still assumes ONE server. Two copies of this process would each run every
// job. Running several needs a shared lock, which is the same work as moving
// the rest of the in-memory state out of the process.

export interface JobStatus { name: string; everyMs: number; runs: number; failures: number; skipped: number; running: boolean; lastStartedAt: number | null; lastMs: number | null; lastError: string | null }

export function createJobs(opts: { log?: (msg: string, extra?: unknown) => void; now?: () => number } = {}) {
  const log = opts.log ?? ((m, e) => console.warn(m, e ?? ''));
  const now = opts.now ?? Date.now;
  const jobs: { status: JobStatus; timer: ReturnType<typeof setInterval> | null; inFlight: Promise<void> | null }[] = [];

  function every(name: string, everyMs: number, fn: () => unknown) {
    const status: JobStatus = { name, everyMs, runs: 0, failures: 0, skipped: 0, running: false, lastStartedAt: null, lastMs: null, lastError: null };
    let skippedThisRun = 0;
    const job: (typeof jobs)[number] = { status, timer: null, inFlight: null };
    const tick = () => {
      if (status.running) {
        status.skipped++;
        skippedThisRun++;
        // say so once per slow run (and again every 100 ticks if it never ends), not on every tick
        if (skippedThisRun === 1 || skippedThisRun % 100 === 0) log(`⏭️  job ${name}: previous run still going after ${now() - (status.lastStartedAt ?? now())} ms, skipping (${status.skipped} skipped)`);
        return;
      }
      status.running = true;
      skippedThisRun = 0;
      status.lastStartedAt = now();
      job.inFlight = Promise.resolve()
        .then(fn)
        .then(
          () => { status.lastError = null; },
          (e: unknown) => { status.failures++; status.lastError = String((e as Error)?.message ?? e).slice(0, 200); log(`⚠️  job ${name} failed:`, e); },
        )
        .finally(() => { status.runs++; status.lastMs = now() - (status.lastStartedAt ?? now()); status.running = false; job.inFlight = null; });
    };
    job.timer = setInterval(tick, everyMs);
    jobs.push(job);
    return { runNow: tick };
  }

  return {
    every,
    status: (): JobStatus[] => jobs.map((j) => ({ ...j.status })),
    /** stop scheduling, and wait (up to `waitMs`) for runs in flight to finish */
    async stopAll(waitMs = 0): Promise<void> {
      for (const j of jobs) { if (j.timer) clearInterval(j.timer); j.timer = null; }
      const running = jobs.map((j) => j.inFlight).filter((p): p is Promise<void> => !!p);
      if (running.length && waitMs > 0) await Promise.race([Promise.all(running), new Promise((r) => setTimeout(r, waitMs))]);
    },
  };
}
