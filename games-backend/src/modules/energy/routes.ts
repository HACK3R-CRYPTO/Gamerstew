import type { Application, Request, RequestHandler, Response } from 'express';
import type { Energy } from './service';

/** A player's energy. Reached through the app's own server, which has checked the sign-in. */
export function registerEnergyRoutes(app: Application, deps: { energy: Energy | null; requireSecret: RequestHandler }): void {
  app.get('/api/energy/:address', deps.requireSecret, (req: Request, res: Response) => {
    if (!deps.energy) { res.json({ on: false }); return; }
    deps.energy.state(req.params.address).then((s) => res.json(s ?? { on: false })).catch(() => res.json({ on: false }));
  });
}
