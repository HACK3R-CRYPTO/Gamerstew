import type { Application, Request, RequestHandler, Response } from 'express';
import { createRoomService, isFail, type RoomService } from './service';
import { ROOM_GAMES } from './games';

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

export function registerRoomRoutes(app: Application, deps: { requireSecret?: RequestHandler; service?: RoomService; now?: () => number; /** told the room's code after every request that may have changed it, so the live line can push it out */ changed?: (code: string) => void } = {}): RoomService {
  const service = deps.service ?? createRoomService(ROOM_GAMES);
  const gate: RequestHandler = deps.requireSecret ?? ((_req, _res, next) => next());
  const body = (req: Request): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});
  const route = (fn: (req: Request) => unknown): RequestHandler => (req: Request, res: Response) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((out) => { if (isFail(out)) res.status(out.status).json({ error: out.error, reason: out.reason }); else { res.json(out); if (deps.changed && req.method === 'POST') { const code = req.params.code ?? (out as { code?: string } | null)?.code; if (code) deps.changed(String(code)); } } })
      .catch((err) => { console.error('room route failed:', err); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
  };
  const allowCreate = createLimiter(deps.now ?? Date.now);
  const who = (req: Request) => String(req.headers['x-client-ip'] ?? 'shared').slice(0, 64);

  app.post('/api/rooms', gate, route((req) => (allowCreate(who(req)) ? service.create(body(req).game, body(req).name, body(req).wallet) : { error: 'slow_down', status: 429 })));
  // must be declared before /:code so "live" is not read as a room code
  app.get('/api/rooms/live', gate, route(() => ({ rooms: service.live() })));
  app.post('/api/rooms/:code/say', gate, route((req) => service.say(req.params.code, body(req).token, body(req).text)));
  app.post('/api/rooms/:code/join', gate, route((req) => service.join(req.params.code, body(req).name, body(req).wallet)));
  app.get('/api/rooms/:code', gate, route((req) => { paying(req.params.code); return service.get(req.params.code, req.query.token, req.query.watch ? who(req) : undefined); }));
  app.post('/api/rooms/:code/start', gate, route((req) => service.start(req.params.code, body(req).token)));
  app.post('/api/rooms/:code/progress', gate, route((req) => service.progress(req.params.code, body(req).token, body(req).progress, body(req).live)));
  app.post('/api/rooms/:code/finish', gate, route(async (req) => { const out = await service.finish(req.params.code, body(req).token, body(req).proof); paying(req.params.code); return out; }));
  // Playing for G$ (off unless the service was given stake rules). A round's
  // payments are made as soon as it ends: a look at the room is enough to set it going.
  const paying = (code: unknown) => { void service.settle(code).catch(() => {}); };
  app.post('/api/rooms/:code/stake', gate, route((req) => service.stake(req.params.code, body(req).token, body(req).entryWei, body(req).permit)));
  app.post('/api/rooms/:code/commit', gate, route((req) => service.commit(req.params.code, body(req).token, body(req).permit)));
  app.post('/api/rooms/:code/unstake', gate, route((req) => service.unstake(req.params.code, body(req).token)));
  app.post('/api/rooms/:code/rematch', gate, route((req) => service.rematch(req.params.code, body(req).token)));
  app.post('/api/rooms/:code/leave', gate, route((req) => service.leave(req.params.code, body(req).token)));
  app.post('/api/rooms/:code/kick', gate, route((req) => service.kick(req.params.code, body(req).token, body(req).seat)));
  return service;
}
