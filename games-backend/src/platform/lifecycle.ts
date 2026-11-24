// ─── Process lifecycle ───────────────────────────────────────────────────────
// Two things a production server owes its users:
//
// 1. A stray rejected promise must not take the whole server down. Node's
//    default is to exit on an unhandled rejection, which drops every request in
//    flight for every player. We log it and keep serving. The one request that
//    caused it would otherwise hang with no reply, so the timing middleware
//    (metrics.ts) answers any request left unanswered with a 504 and counts it.
//    An uncaught exception
//    is different: the process may be in a broken state, so we log and exit and
//    let the platform start a clean one.
//
// 2. A redeploy must not cut players off mid-request. On SIGTERM we stop taking
//    new connections, let the requests in flight finish, then exit. If they do
//    not finish within the grace period we exit anyway.

import type { Server } from 'http';

export interface LifecycleOptions {
  graceMs: number;
  log?: (msg: string, extra?: unknown) => void;
  exit?: (code: number) => void;
  /** run the moment shutdown starts: end long-lived streams and stop timers, or
   *  close() would wait on them for the whole grace period */
  beforeClose?: () => void;
  /** run after the server stops accepting, before exit (close pools, flush) */
  onShutdown?: () => void | Promise<void>;
}

export function installLifecycle(server: Server, opts: LifecycleOptions) {
  const log = opts.log ?? ((m, e) => console.error(m, e ?? ''));
  const exit = opts.exit ?? ((c) => process.exit(c));
  let stopping = false;

  const onRejection = (reason: unknown) => log('⚠️  unhandled promise rejection (server kept running):', reason);
  const onException = (err: unknown) => {
    log('💥 uncaught exception, exiting for a clean restart:', err);
    exit(1);
  };
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`🛑 ${signal}: finishing requests in flight (up to ${opts.graceMs} ms)`);
    try {
      opts.beforeClose?.();
    } catch (e) {
      log('beforeClose hook failed:', e);
    }
    const hard = setTimeout(() => {
      log('⏱️  grace period over, exiting with requests still open');
      exit(1);
    }, opts.graceMs);
    hard.unref();
    server.close(async () => {
      try {
        await opts.onShutdown?.();
      } catch (e) {
        log('shutdown hook failed:', e);
      }
      clearTimeout(hard);
      exit(0);
    });
    // A keep-alive socket stays open after its request finishes, and close()
    // waits for every socket. So keep closing the idle ones until none are left;
    // sockets with a request in flight are never touched.
    server.closeIdleConnections();
    const reap = setInterval(() => server.closeIdleConnections(), 50);
    reap.unref();
    server.once('close', () => clearInterval(reap));
  };
  const onTerm = () => shutdown('SIGTERM');
  const onInt = () => shutdown('SIGINT');

  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);

  return {
    shutdown,
    onRejection,
    isStopping: () => stopping,
    uninstall() {
      process.off('unhandledRejection', onRejection);
      process.off('uncaughtException', onException);
      process.off('SIGTERM', onTerm);
      process.off('SIGINT', onInt);
    },
  };
}
