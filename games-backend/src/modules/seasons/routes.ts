// GET /api/seasons · public read; the origin gate in server.js is its guard, as before.
import type { Application, Request, Response } from 'express';
import { createSeasonsService, type SeasonsDeps } from './service';

export function registerSeasonsRoutes(app: Application, deps: SeasonsDeps) {
  const service = createSeasonsService(deps);
  app.get('/api/seasons', (req: Request, res: Response) => {
    service.seasons().then(
      (out) => res.json(out),
      (e) => { console.error(`${req.path} crashed:`, e); if (!res.headersSent) res.status(500).json({ error: 'Failed to load' }); },
    );
  });
  return service;
}
