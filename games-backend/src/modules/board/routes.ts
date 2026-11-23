// ─── Board routes: HTTP only ─────────────────────────────────────────────────
//   GET /api/leaderboard?game=&limit=&page=|offset=
//   GET /api/usernames?wallets=0xa,0xb
//   GET /api/activity[?player=0x…]
//   GET /api/stats
// These are public reads: the origin gate in server.js is their only guard, as before.

import type { Application, Request, RequestHandler, Response } from 'express';
import { createBoardService, type BoardDeps, type Reply } from './service';

export function registerBoardRoutes(app: Application, deps: BoardDeps) {
  const service = createBoardService(deps);
  // a read that throws answers with an error instead of leaving the page waiting
  const route = (fn: (q: Record<string, unknown>) => Promise<Reply>): RequestHandler => (req: Request, res: Response) => {
    Promise.resolve()
      .then(() => fn(req.query as Record<string, unknown>))
      .then((out) => res.status(out.status).json(out.body))
      .catch((e) => { console.error(`${req.path} crashed:`, e); if (!res.headersSent) res.status(500).json({ error: 'Failed to load' }); });
  };
  app.get('/api/leaderboard', route(service.leaderboard));
  app.get('/api/usernames', route(service.usernames));
  app.get('/api/activity', route(service.activity));
  app.get('/api/stats', route(() => service.stats()));
  return service;
}
