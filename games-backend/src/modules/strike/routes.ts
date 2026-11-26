// ─── Street Strike online rooms: HTTP ────────────────────────────────────────
// The thinnest layer: read the request, call the service, write the reply.
// No rules live here.
//
//   POST /api/strike/rooms                 { name }          → { code, token, seat }
//   POST /api/strike/rooms/:code/join      { name }          → { code, token, seat }
//   GET  /api/strike/rooms/:code?token=                      → room
//   POST /api/strike/rooms/:code/start     { token }         (host)
//   POST /api/strike/rooms/:code/roll      { token, rolls }  (your whole card so far)
//   POST /api/strike/rooms/:code/rematch   { token }         (host)
//   POST /api/strike/rooms/:code/leave     { token }

import type { Application, Request, RequestHandler, Response } from 'express';
import { createStrikeService, isFail, type StrikeService } from './service';
import { MemoryRoomStore } from './store';

// Making rooms is the one thing a stranger can do that costs memory, so it is
// capped per player address. The address is the browser's, passed on by our own
// frontend server; without it everyone shares one generous bucket.
const CREATE_LIMIT = 8; // rooms per address per window
const CREATE_WINDOW_MS = 10 * 60 * 1000;
function createLimiter(now: () => number) {
  const seen = new Map<string, { n: number; from: number }>();
  return (who: string): boolean => {
    const t = now();
    if (seen.size > 5000) for (const [k, v] of seen) if (t - v.from > CREATE_WINDOW_MS) seen.delete(k);
    if (seen.size > 20000) seen.clear(); // never let the limiter itself become the leak
    const e = seen.get(who);
    if (!e || t - e.from > CREATE_WINDOW_MS) { seen.set(who, { n: 1, from: t }); return true; }
    return ++e.n <= CREATE_LIMIT;
  };
}

export interface StrikeDeps {
  /** auth for calls from our own frontend server; omitted in tests */
  requireSecret?: RequestHandler;
  service?: StrikeService;
  now?: () => number;
  /** told the room's code after every request that may have changed it, so the live line can push it out */
  changed?: (code: string) => void;
}

export function registerStrikeRoutes(app: Application, deps: StrikeDeps = {}): StrikeService {
  const service = deps.service ?? createStrikeService(new MemoryRoomStore());
  const gate: RequestHandler = deps.requireSecret ?? ((_req, _res, next) => next());
  const body = (req: Request): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});

  // One wrapper for every route: a failure becomes its status code, and a
  // thrown error becomes a 500 instead of an unhandled rejection.
  const route = (fn: (req: Request) => Promise<unknown>): RequestHandler => (req: Request, res: Response) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((out) => { if (isFail(out)) res.status(out.status).json({ error: out.error }); else { res.json(out); if (deps.changed && req.method === 'POST') { const code = req.params.code ?? (out as { code?: string } | null)?.code; if (code) deps.changed(String(code)); } } })
      .catch((err) => { console.error('strike route failed:', err); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
  };
  const allowCreate = createLimiter(deps.now ?? Date.now);
  const who = (req: Request) => String(req.headers['x-client-ip'] ?? 'shared').slice(0, 64);

  app.post('/api/strike/rooms', gate, route(async (req) => (allowCreate(who(req)) ? service.create(body(req).name) : { error: 'slow_down', status: 429 })));
  app.get('/api/strike/live', gate, route(async () => ({ rooms: await service.live() })));
  app.post('/api/strike/rooms/:code/join', gate, route((req) => service.join(req.params.code, body(req).name)));
  app.get('/api/strike/rooms/:code', gate, route((req) => service.get(req.params.code, req.query.token, req.query.watch ? who(req) : undefined)));
  app.post('/api/strike/rooms/:code/start', gate, route((req) => service.start(req.params.code, body(req).token)));
  app.post('/api/strike/rooms/:code/roll', gate, route((req) => service.roll(req.params.code, body(req).token, body(req).rolls, body(req).throws)));
  app.post('/api/strike/rooms/:code/say', gate, route((req) => service.say(req.params.code, body(req).token, body(req).text)));
  app.post('/api/strike/rooms/:code/rematch', gate, route((req) => service.rematch(req.params.code, body(req).token)));
  app.post('/api/strike/rooms/:code/leave', gate, route((req) => service.leave(req.params.code, body(req).token)));
  return service;
}
