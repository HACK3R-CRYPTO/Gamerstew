// ─── The rules every HTTP server should follow, in one place ─────────────────
//
// 1. A handler that fails must ANSWER. Express 4 does not catch a rejected
//    promise from an async route: the request simply never gets a reply. There
//    are dozens of async routes here, so instead of trusting each one to catch
//    its own errors, `catchAsync` wraps every route as it is registered and
//    sends any failure to the error handler.
//
// 2. One error handler, and it never leaks. Express's default prints the stack
//    trace into the page unless NODE_ENV is "production". Ours logs the error
//    with a request id, and tells the client only that something went wrong
//    and which id to quote.
//
// 3. Errors are JSON, like everything else this API returns: a body that is not
//    valid JSON is a 400, one that is too large is a 413, an unknown path is a
//    404. None of them is an HTML page.
//
// 4. Say as little as possible about ourselves, and tell browsers to be strict.
//
// 5. A liveness check must be free. /healthz touches nothing: it answers "the
//    process is up" even when the database is not, which is exactly what a
//    platform restart check needs to know.

import { randomUUID } from 'crypto';
import type { Application, ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'] as const;
type Log = (msg: string, extra?: unknown) => void;

/** Wrap every route handler registered from now on, so a thrown error or a
 *  rejected promise reaches the error handler instead of hanging the request. */
export function catchAsync(app: Application): void {
  const guard = (fn: unknown): unknown => {
    // only plain (req, res, next) handlers; error handlers (4 arguments) are left alone
    if (typeof fn !== 'function' || fn.length >= 4) return fn;
    const handler = fn as RequestHandler;
    const wrapped: RequestHandler = function (this: unknown, req, res, next) {
      try {
        const out = handler.call(this, req, res, next) as unknown;
        if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).catch(next);
      } catch (e) {
        next(e);
      }
    };
    return wrapped;
  };
  const target = app as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const m of METHODS) {
    const original = target[m]!;
    target[m] = function (this: unknown, ...args: unknown[]) {
      // app.get('setting') is a getter, not a route: leave it exactly as it was
      if (m === 'get' && args.length === 1) return original.apply(this, args);
      return original.apply(this, args.map((a) => (Array.isArray(a) ? a.map(guard) : guard(a))));
    };
  }
}

/** Mount first: request id, security headers, and the free liveness check. */
export function hardenApp(app: Application, opts: { isStopping?: () => boolean } = {}): void {
  app.disable('x-powered-by');
  app.use((req: Request, res: Response, next: NextFunction) => {
    // keep the platform's id when there is one, so our logs line up with theirs
    const given = req.headers['x-request-id'] ?? req.headers['x-railway-request-id'];
    const id = typeof given === 'string' && /^[\w.:-]{6,80}$/.test(given) ? given : randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader('x-request-id', id);
    // this API serves JSON to other programs; nothing it returns should be sniffed, framed or cached by a shared proxy
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    next();
  });
  // Liveness: is the process able to answer at all? No database, no chain.
  // While shutting down it says so, and the platform stops sending traffic.
  app.get('/healthz', (_req: Request, res: Response) => {
    if (opts.isStopping?.()) res.status(503).json({ status: 'stopping' });
    else res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
  });
}

/** Mount LAST, after every route: the 404 and the one error handler. */
export function installErrorHandlers(app: Application, opts: { log?: Log } = {}): void {
  const log: Log = opts.log ?? ((m, e) => console.error(m, e ?? ''));
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found', path: req.path });
  });
  const onError: ErrorRequestHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
    const e = (err ?? {}) as { type?: string; status?: number; statusCode?: number; message?: string };
    const id = (req as Request & { id?: string }).id;
    if (res.headersSent) return next(err); // the reply already started: let Express close the socket
    // what the body parser reports about the request itself: the client's mistake, not ours
    if (e.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Invalid JSON body' });
    if (e.type === 'entity.too.large') return void res.status(413).json({ error: 'Request body too large' });
    const status = Number(e.status ?? e.statusCode);
    if (status >= 400 && status < 500) return void res.status(status).json({ error: 'Bad request' });
    log(`💥 ${req.method} ${req.path} failed [${id}]:`, err);
    res.status(500).json({ error: 'Internal error', requestId: id });
  };
  app.use(onError);
}

/** A fetch that gives up. An upstream that stops answering must not hold our
 *  requests open with it; every outbound call gets a deadline. */
export function fetchWithTimeout(ms: number, inner: typeof fetch = fetch): typeof fetch {
  return (input, init) => inner(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });
}
