// ─── Progression routes: HTTP only ───────────────────────────────────────────
//   GET  /api/badges/:address          GET  /api/user/:address
//   GET  /api/notifications/:address   GET  /api/streak/:address
//   GET  /api/achievements/:address    POST /api/missions/claim   (internal)
//   GET  /api/missions/today/:address  POST /api/record-claim     (internal)
// :address is checked to be a wallet before any of these run (platform/validate).

import type { Application, Request, RequestHandler, Response } from 'express';
import type { Progression, Reply } from './service';

export function registerProgressionRoutes(app: Application, p: Progression, gates: { requireSecret: RequestHandler; limiter: RequestHandler }): void {
  const send = (fn: (req: Request) => Promise<Reply>): RequestHandler => async (req: Request, res: Response) => { const out = await fn(req); res.status(out.status).json(out.body); };
  const addr = (req: Request) => String(req.params.address);
  const body = (req: Request) => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});
  const r = p.routes;
  app.get('/api/badges/:address', send((q) => r.badges(addr(q))));
  app.get('/api/notifications/:address', send((q) => r.notifications(addr(q), q.query.limit)));
  app.get('/api/achievements/:address', send((q) => r.achievements(addr(q))));
  app.get('/api/missions/today/:address', send((q) => r.missionsToday(addr(q))));
  app.post('/api/missions/claim', gates.requireSecret, gates.limiter, send((q) => r.claimMission(body(q))));
  app.get('/api/user/:address', send((q) => r.user(addr(q))));
  app.post('/api/record-claim', gates.requireSecret, send((q) => r.recordClaim(body(q))));
  app.get('/api/streak/:address', send((q) => r.streak(addr(q))));
}
